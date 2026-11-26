
export async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const normalizedUrl = baseUrl.replace(/\/$/, "");

  const response = await fetch(`${normalizedUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `API ${response.status}: ${detail || response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

export const useMocks =
  import.meta.env.VITE_USE_MOCKS !== "false";
