// All calls to the FastAPI backend. Paths start with /api, which Vite forwards
// to port 8000 in development (see vite.config.js).
//
// When the frontend is hosted separately (e.g. GitHub Pages), set VITE_API_URL
// at build time to the backend's address, e.g. https://name-space.hf.space
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function request(path, options) {
  const response = await fetch(`${API_BASE}/api${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // FastAPI puts error messages in "detail" (a list for invalid input).
    const detail = typeof body.detail === "string" ? body.detail : "Please check your input and try again.";
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return body;
}

export const getTopics = () => request("/topics");
export const getCategories = () => request("/categories");
export const getTopicMap = (field) => request(`/topics/${encodeURIComponent(field)}`);
export const getJob = (jobId) => request(`/jobs/${jobId}`);

export const buildTopic = (topic, category, maxPapers) =>
  request("/topics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, category: category || null, max_papers: maxPapers }),
  });
