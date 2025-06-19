// ✅ cacheMiddleware.js (drop this at the top of your server.js or as a separate file)
const cache = {};

function cacheMiddleware(keyFn, ttl = 300) {
  return async (req, res, next) => {
    const key = typeof keyFn === 'function' ? keyFn(req) : keyFn;
    const cached = cache[key];

    if (cached && Date.now() < cached.expires) {
      return res.json(cached.data);
    }

    // Override res.json to intercept the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      cache[key] = { data: body, expires: Date.now() + ttl * 1000 };
      originalJson(body);
    };

    next();
  };
}

module.exports = cacheMiddleware;
