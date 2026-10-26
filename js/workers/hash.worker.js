self.onmessage = async (e) => {
  try {
    const buf = e.data.buffer;
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const hex = [...new Uint8Array(hash)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    self.postMessage({ hash: hex });
  } catch (err) {
    self.postMessage({ error: err?.message || "Hash failed" });
  }
};
