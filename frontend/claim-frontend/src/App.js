import React, { useState, useRef } from "react";
import "./App.css";

const BACKEND_URL = "http://127.0.0.1:9000/predict";

/**
 * Frontend-side base costs for per-detection breakdown.
 */
const CLASS_BASE_COST = {
  "Dent": 3000,
  "Crack": 5000,
  "Paint Scratch": 3500,
  "Broken Part": 10000,
  "Deformation": 20000,
  "Light Broken": 8000,
  "Broken Glass": 8000
};

function computeDetCost(base_cost, conf, area_ratio) {
  const factor = 0.6 + conf * 0.8 + area_ratio * 2.0;
  return Math.round(base_cost * factor);
}

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [showJSON, setShowJSON] = useState(false);
  const [modalIndex, setModalIndex] = useState(null);
  const fileRef = useRef();

  const handleFiles = (files) => {
    const arr = Array.from(files || []);
    const allowed = arr.slice(0, Math.max(0, 20 - items.length));

    const newItems = allowed.map((f, i) => ({
      id: Date.now() + "_" + i,
      file: f,
      preview: URL.createObjectURL(f),
      annotated: null,
      result: null,
      loading: false,
      naturalSize: null
    }));

    setItems((prev) => [...newItems, ...prev]);
  };

  const onInputChange = (e) => {
    handleFiles(e.target.files);
    e.target.value = null;
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e) => e.preventDefault();

  const analyzeOne = async (index) => {
    const copy = [...items];
    const it = copy[index];
    if (!it) return;

    copy[index].loading = true;
    setItems(copy);

    const fd = new FormData();
    fd.append("file", it.file);

    try {
      const res = await fetch(BACKEND_URL, { method: "POST", body: fd });
      const data = await res.json();

      copy[index].result = data;
      copy[index].annotated = data.annotated_image || null;
      copy[index].loading = false;

      setItems(copy);
      setSelectedIndex(index);
      setShowJSON(false);
    } catch (err) {
      console.error("analyze error", err);
      copy[index].loading = false;
      copy[index].result = { error: String(err) };

      setItems(copy);
    }
  };

  const analyzeAll = async () => {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].loading) await analyzeOne(i);
    }
  };

  const removeItem = (idx) => {
    URL.revokeObjectURL(items[idx]?.preview);
    const newItems = items.filter((_, i) => i !== idx);

    setItems(newItems);

    if (selectedIndex === idx) {
      setSelectedIndex(null);
      setShowJSON(false);
    }
  };

  const totalCost = items
    .filter((it) => it.result?.estimated_cost)
    .reduce((s, it) => s + Number(it.result.estimated_cost || 0), 0);

  const getDetRows = (item) => {
    const rows = [];
    const natural = item?.naturalSize || { width: 1, height: 1 };
    const W = natural.width || 1;
    const H = natural.height || 1;

    const detections = item?.result?.detections || [];

    for (let d of detections) {
      const [x1, y1, x2, y2] = d.bbox;
      const w = Math.max(0, x2 - x1);
      const h = Math.max(0, y2 - y1);
      const area_ratio = Math.min(1, (w * h) / (W * H + 1e-9));
      const area_pct = +(area_ratio * 100).toFixed(2);

      const base_cost = CLASS_BASE_COST[d.class_name] || 8000;
      const det_cost = computeDetCost(base_cost, d.confidence, area_ratio);

      rows.push({
        name: d.class_name,
        confidence: +(d.confidence * 100).toFixed(1),
        area_pct,
        cost: det_cost
      });
    }

    return rows;
  };

  const openModal = (index) => setModalIndex(index);
  const closeModal = () => setModalIndex(null);
  const prevModal = () => setModalIndex((i) => (i > 0 ? i - 1 : i));
  const nextModal = () => setModalIndex((i) => (i < items.length - 1 ? i + 1 : i));

  const onPreviewLoad = (e, idx) => {
    const img = e.target;
    const copy = [...items];
    copy[idx].naturalSize = { width: img.naturalWidth, height: img.naturalHeight };
    setItems(copy);
  };

  const downloadImage = (item) => {
    const url = item.annotated || item.preview;
    const a = document.createElement("a");
    a.href = url;
    a.download = item.file.name.replace(/\.[^/.]+$/, "") + "_annotated.png";
    a.click();
  };

  const BreakdownTable = ({ item }) => {
    if (!item || !item.result) return <div className="muted">No breakdown (analyze image)</div>;

    const rows = getDetRows(item);
    if (!rows.length) return <div className="muted">No detections</div>;

    const subtotal = rows.reduce((s, r) => s + r.cost, 0);

    return (
      <table className="break-table">
        <thead>
          <tr>
            <th>Damage</th>
            <th>Confidence</th>
            <th>Area %</th>
            <th>Cost (₹)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.name}</td>
              <td>{r.confidence}%</td>
              <td>{r.area_pct}%</td>
              <td>₹ {r.cost.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="3" className="tfoot-label">Subtotal</td>
            <td className="tfoot-value">₹ {subtotal.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
    );
  };

  const selectedItem = selectedIndex !== null ? items[selectedIndex] : null;

  return (
    <div className="app-root" onDrop={onDrop} onDragOver={onDragOver}>
      <header className="topbar">
        <div className="brand">Vehicle Damage Detection</div>

        <div className="controls">
          <div className="uploader">
            <button className="btn ghost" onClick={() => fileRef.current.click()}>
              Choose Files
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*"
              onChange={onInputChange}
              style={{ display: "none" }}
            />
            <div className="drag-hint">or drag & drop images here</div>
          </div>

          <div className="actions">
            <button className="btn gradient" onClick={analyzeAll} disabled={items.length === 0}>
              Analyze All
            </button>

            <div className="total-cost">
              <div className="tc-label">Total Cost</div>
              <div className="tc-value">₹ {totalCost.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="main-grid">
        <section className="gallery">
          {items.length === 0 && (
            <div className="empty">
              <div className="empty-title">No images yet</div>
              <div className="empty-sub">Drop files or click Choose Files</div>
            </div>
          )}

          {items.map((it, idx) => (
            <div key={it.id} className={`card ${selectedIndex === idx ? "card-selected" : ""}`}>
              <div className="card-image-wrap">
                <img
                  src={it.annotated || it.preview}
                  alt={it.file.name}
                  className="card-image"
                  onClick={() => openModal(idx)}
                  onLoad={(e) => onPreviewLoad(e, idx)}
                />

                {it.annotated && <span className="annot-badge">Annotated</span>}
                {it.loading && <div className="loading-overlay">Analyzing…</div>}
              </div>

              <div className="card-foot">
                <div className="filename" title={it.file.name}>{it.file.name}</div>

                <div className="card-buttons">
                  <button
                    className="btn small gradient"
                    onClick={() => analyzeOne(idx)}
                    disabled={it.loading}
                  >
                    {it.loading ? "Processing…" : "Analyze"}
                  </button>

                  <button className="btn small danger" onClick={() => removeItem(idx)}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>

        <aside className="panel">
          <div className="panel-inner">
            <h3 className="panel-title">Selected Image</h3>

            {!selectedItem || !selectedItem.result ? (
              <div className="muted">Select an analyzed image</div>
            ) : (
              <>
                <div className="result-row">
                  <div className="label">Detections</div>
                  <div className="value">{selectedItem.result.num_detections}</div>
                </div>

                <div className="result-row">
                  <div className="label">Estimated Cost</div>
                  <div className="value">₹ {selectedItem.result.estimated_cost?.toLocaleString()}</div>
                </div>

                <h4 className="subhead">Damage Breakdown</h4>
                <BreakdownTable item={selectedItem} />

                <button className="btn ghost" style={{ marginTop: 12 }}
                  onClick={() => setShowJSON((s) => !s)}>
                  {showJSON ? "Hide JSON" : "Show JSON"}
                </button>

                {showJSON && (
                  <pre className="json-box">
                    {JSON.stringify(selectedItem.result, null, 2)}
                  </pre>
                )}
              </>
            )}
          </div>
        </aside>
      </main>

      <footer className="footer">
        © {new Date().getFullYear()} Vehicle Damage Detection
      </footer>

      {modalIndex !== null && modalIndex >= 0 && modalIndex < items.length && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div className="modal-filename">{items[modalIndex].file.name}</div>

              <div className="modal-actions">
                <button className="btn ghost" onClick={() => downloadImage(items[modalIndex])}>
                  Download
                </button>
                <button className="btn ghost" onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>

            <div className="modal-image-wrap">
              <img
                src={items[modalIndex].annotated || items[modalIndex].preview}
                alt=""
                className="modal-image"
              />
            </div>

            <div className="modal-nav">
              <button
                className="btn small"
                onClick={prevModal}
                disabled={modalIndex === 0}
              >
                ◀ Prev
              </button>

              <button
                className="btn small"
                onClick={nextModal}
                disabled={modalIndex === items.length - 1}
              >
                Next ▶
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
