module.exports = function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      a: {
        endpoint: process.env.DEFAULT_ENDPOINT_A || "",
        model: process.env.DEFAULT_MODEL_A || "",
        hasKey: !!process.env.DEFAULT_API_KEY_A,
      },
      b: {
        endpoint: process.env.DEFAULT_ENDPOINT_B || "",
        model: process.env.DEFAULT_MODEL_B || "",
        hasKey: !!process.env.DEFAULT_API_KEY_B,
      },
    })
  );
};
