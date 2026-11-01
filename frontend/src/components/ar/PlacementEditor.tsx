"use client";
import { useEffect, useState } from "react";
import { apiRequest, errorMessage } from "@/lib/api";
import {
  getPlacement,
  placementPath,
  validPlacement,
  type Placement,
} from "@/lib/ar/data";
import type { ProjectStep } from "@/types/projects";
export function PlacementEditor({
  projectId,
  step,
}: {
  projectId: string;
  step: ProjectStep;
}) {
  const [loadedStep, setLoadedStep] = useState("");
  const [value, setValue] = useState<Placement | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    getPlacement(projectId, step.id)
      .then((p) => {
        if (active) {
          setValue(p);
          setConfirmed(false);
          setLoadedStep(step.id);
        }
      })
      .catch((e) => {
        if (active) {
          setStatus(errorMessage(e));
          setLoadedStep(step.id);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, step.id]);
  function change(update: Partial<Placement>) {
    if (value) setValue({ ...value, ...update });
    setConfirmed(false);
  }
  function start() {
    const b = step.required_blocks[0];
    if (!b) return;
    setValue({
      target_block_id: b.block_id,
      instance: 1,
      origin: "tabletop_session",
      method: "manual_authoring",
      evidence: "approximate",
      confirmed: true,
      dimensions: { x_mm: 100, y_mm: 100, z_mm: 100 },
      studs: null,
      position_m: [0, 0, 0],
      rotation_deg: [0, 0, 0],
    });
    setConfirmed(false);
  }
  async function save() {
    if (!value || !confirmed || !validPlacement(value)) return;
    try {
      await apiRequest(placementPath(projectId, step.id), {
        method: "PUT",
        body: JSON.stringify(value),
      });
      setStatus(
        "AR guidance saved. Existing verification must be refreshed; the hologram is not evidence.",
      );
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  return (
    <details className="panel ar-editor">
      <summary>Spatial AR placement (optional)</summary>
      <p>
        Metres relative to a manually confirmed HoloLens tabletop origin. X
        right, Y up, Z toward you. No camera calibration is reused.
      </p>
      {loadedStep !== step.id ? (
        <p>Loading placement…</p>
      ) : !value ? (
        <button
          className="button secondary"
          disabled={!step.required_blocks.length}
          onClick={start}
        >
          Author placement with a 10 cm proxy
        </button>
      ) : (
        <>
          <label className="field">
            AR target
            <select
              value={value.target_block_id}
              onChange={(e) =>
                change({ target_block_id: e.target.value, studs: null })
              }
            >
              {step.required_blocks.map((b) => (
                <option key={b.block_id} value={b.block_id}>
                  {b.block.name} · {b.block.color}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Instance number
            <input
              type="number"
              min={1}
              value={value.instance}
              onChange={(e) => change({ instance: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Dimension evidence
            <select
              value={value.evidence}
              onChange={(e) =>
                change({
                  evidence: e.target.value as Placement["evidence"],
                  studs: null,
                })
              }
            >
              <option value="approximate">
                Approximate alignment proxy — not measured
              </option>
              <option value="measured">
                I measured this rectangular block
              </option>
            </select>
          </label>
          <div className="form-grid">
            {(["x_mm", "y_mm", "z_mm"] as const).map((axis, i) => (
              <label className="field" key={axis}>
                {
                  [
                    "Length X (mm)",
                    "Body height Y (mm, excluding studs)",
                    "Depth Z (mm)",
                  ][i]
                }
                <input
                  type="number"
                  min={0.1}
                  max={1000}
                  value={value.dimensions[axis]}
                  onChange={(e) =>
                    change({
                      dimensions: {
                        ...value.dimensions,
                        [axis]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p>
            Top-down authoring: click the 1 × 1 m grid to choose X/Z. The cyan
            mark is intended placement, not a measured part.
          </p>
          <svg
            className="ar-topdown"
            viewBox="-500 -500 1000 1000"
            role="img"
            aria-label="Top-down placement editor"
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              change({
                position_m: [
                  (e.clientX - b.left) / b.width - 0.5,
                  value.position_m[1],
                  (e.clientY - b.top) / b.height - 0.5,
                ],
              });
            }}
          >
            <rect x={-500} y={-500} width={1000} height={1000} fill="#152536" />
            <path
              d="M-500 0H500 M0 -500V500"
              stroke="#7a8a9a"
              strokeWidth={2}
            />
            <circle
              cx={value.position_m[0] * 1000}
              cy={value.position_m[2] * 1000}
              r={15}
              fill="#69e8ff"
            />
          </svg>
          <div className="form-grid">
            {["X", "Y", "Z"].map((axis, i) => (
              <label className="field" key={axis}>
                Position {axis} (m)
                <input
                  type="number"
                  step={0.001}
                  min={-2}
                  max={2}
                  value={value.position_m[i]}
                  onChange={(e) =>
                    change({
                      position_m: value.position_m.map((v, n) =>
                        n === i ? Number(e.target.value) : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
            {["X", "Y", "Z"].map((axis, i) => (
              <label className="field" key={axis}>
                Rotation {axis} (degrees)
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={value.rotation_deg[i]}
                  onChange={(e) =>
                    change({
                      rotation_deg: value.rotation_deg.map((v, n) =>
                        n === i ? Number(e.target.value) : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p>
            Stud geometry is optional. Enter measured stud
            spacing/diameter/height only after registering the grid in Block
            Library.
          </p>
          <label>
            <input
              type="checkbox"
              disabled={value.evidence !== "measured"}
              checked={!!value.studs}
              onChange={(e) =>
                change({
                  studs: e.target.checked
                    ? { x: 1, z: 1, pitch_mm: 0, diameter_mm: 0, height_mm: 0 }
                    : null,
                })
              }
            />{" "}
            Add confirmed stud grid
          </label>
          {value.studs && (
            <div className="form-grid">
              {(
                ["x", "z", "pitch_mm", "diameter_mm", "height_mm"] as const
              ).map((key) => (
                <label className="field" key={key}>
                  Stud {key}
                  <input
                    type="number"
                    min={0.1}
                    value={value.studs![key]}
                    onChange={(e) =>
                      change({
                        studs: {
                          ...value.studs!,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I confirm the dimensions, evidence label and intended placement.
            </span>
          </label>
          <button
            className="button primary"
            disabled={!confirmed || !validPlacement(value)}
            onClick={() => void save()}
          >
            Save AR placement
          </button>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await apiRequest(placementPath(projectId, step.id), {
                  method: "DELETE",
                });
                setValue(null);
                setStatus("Placement removed.");
              } catch (e) {
                setStatus(errorMessage(e));
              }
            }}
          >
            Remove AR placement
          </button>
        </>
      )}
      {status && <p role="status">{status}</p>}
    </details>
  );
}
