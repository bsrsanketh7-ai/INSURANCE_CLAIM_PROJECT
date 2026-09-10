from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import io, os, base64
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)

# -------------------------
# TRANSLATIONS (Viet -> EN)
# -------------------------
CLASS_TRANSLATION = {
    "mat_bo_phan": "Broken Part",
    "rach": "Crack",
    "mop_lom": "Dent",
    "tray_son": "Paint Scratch",
    "thung": "Deformation",
    "be_den": "Light Broken"
}

# -----------------------------------
# Insurance-grade base costs (INR)
# update these numbers to match vendor quotes
# -----------------------------------
CLASS_BASE_COST = {
    "Dent": 3000,
    "Crack": 5000,
    "Paint Scratch": 3500,
    "Broken Part": 10000,
    "Deformation": 20000,
    "Light Broken": 8000,
    "Broken Glass": 8000
}

# Load YOLO model once
model_path = os.path.join(os.path.dirname(__file__), "best.pt")
model = YOLO(model_path)
print("Loaded YOLO model:", model_path)

def pil_to_base64(img_pil):
    buf = io.BytesIO()
    img_pil.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

# -----------------------------------------
# New cost & severity function (insurance-grade)
# -----------------------------------------
def compute_severity_and_cost(detections, W, H):
    """
    detections: list of dicts with keys class_name, confidence, bbox
    W, H: image width and height
    returns: (severity_label, severity_score (0..1), estimated_cost int)
    """
    total_cost = 0.0
    score_accum = 0.0

    for det in detections:
        cname = det["class_name"]
        conf = float(det["confidence"])
        x1, y1, x2, y2 = det["bbox"]
        w = max(0.0, x2 - x1)
        h = max(0.0, y2 - y1)
        area_ratio = (w * h) / (W * H + 1e-9)

        base_cost = CLASS_BASE_COST.get(cname, 8000)

        # Insurance-grade formula:
        # contribution factor depends on confidence and area ratio
        factor = 0.6 + (conf * 0.8) + (area_ratio * 2.0)  # tuned multipliers
        det_cost = base_cost * factor

        total_cost += det_cost
        score_accum += conf * area_ratio

    # map score_accum to severity score (0..1)
    severity_score = min(1.0, round(score_accum * 8.0, 3))

    if severity_score < 0.25:
        severity = "Light"
    elif severity_score < 0.6:
        severity = "Medium"
    else:
        severity = "Severe"

    return severity, severity_score, int(round(total_cost))

# ------------------------
# Simple util test endpoint
# ------------------------
@app.route("/test", methods=["GET"])
def test():
    return jsonify({"message": "Backend OK"})

# ------------------------
# Predict endpoint
# ------------------------
@app.route("/predict", methods=["POST"])
def predict():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    uploaded_file = request.files["file"]
    if uploaded_file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    try:
        img = Image.open(uploaded_file.stream).convert("RGB")
    except Exception as e:
        return jsonify({"error": "Cannot open image", "exception": str(e)}), 400

    W, H = img.size

    # run YOLO inference
    results = model.predict(img, imgsz=640)
    res = results[0]

    detections = []
    orig_names = res.names

    # gather detections
    for box in res.boxes:
        xyxy = box.xyxy.cpu().numpy()[0].tolist()
        conf = float(box.conf.cpu().numpy()[0])
        clsid = int(box.cls.cpu().numpy()[0])
        original = orig_names.get(clsid, str(clsid))
        cname = CLASS_TRANSLATION.get(original, original)  # translate to english

        detections.append({
            "class_id": clsid,
            "class_name": cname,
            "confidence": conf,
            "bbox": xyxy
        })

    # compute severity and cost
    severity_label, severity_score, estimated_cost = compute_severity_and_cost(detections, W, H)

    # override res.names so annotated image labels are English
    translated_map = {}
    for k in orig_names:
        translated_map[k] = CLASS_TRANSLATION.get(orig_names[k], orig_names[k])
    res.names = translated_map

    # annotated image
    try:
        annotated_np = res.plot()  # numpy array (RGB)
        annotated_pil = Image.fromarray(annotated_np)
        annotated_b64 = pil_to_base64(annotated_pil)
    except Exception as e:
        print("Annotate error:", e)
        annotated_b64 = None

    # human summary (short)
    summary_parts = []
    for d in detections:
        summary_parts.append(f"{d['class_name']} detected with {round(d['confidence']*100,1)}%")
    summary = ". ".join(summary_parts)

    payload = {
        "num_detections": len(detections),
        "detections": detections,
        "severity": severity_label,
        "severity_score": severity_score,
        "estimated_cost": estimated_cost,
        "annotated_image": annotated_b64,
        "summary": summary
    }

    return jsonify(payload)


if __name__ == "__main__":
    # 0.0.0.0 so reachable on the network if needed
    app.run(host="0.0.0.0", port=9000, debug=True)
