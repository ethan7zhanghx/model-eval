module.exports = function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const endpointA = process.env.DEFAULT_ENDPOINT_A || "";
  const modelA    = process.env.DEFAULT_MODEL_A    || "";
  const endpointB = process.env.DEFAULT_ENDPOINT_B || "";
  const modelB    = process.env.DEFAULT_MODEL_B    || "";

  // 每次环境变量变化时 hash 也会变，客户端据此判断是否需要刷新默认值
  const hash = [endpointA, modelA, endpointB, modelB].join("|");

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      hash,
      a: { endpoint: endpointA, model: modelA, hasKey: !!process.env.DEFAULT_API_KEY_A },
      b: { endpoint: endpointB, model: modelB, hasKey: !!process.env.DEFAULT_API_KEY_B },
    })
  );
};
