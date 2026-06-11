const jsonHeaders = {
  "Content-Type": "application/json"
};

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Error de API");
  return data;
}

export async function apiGet(path) {
  const response = await fetch(`/api${path}`);
  return parseResponse(response);
}

export async function adminPost(path, password, body = {}) {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      ...jsonHeaders,
      "x-admin-password": password
    },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}
