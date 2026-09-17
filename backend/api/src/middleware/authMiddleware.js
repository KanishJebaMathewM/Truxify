const admin = require('firebase-admin');

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (process.env.BYPASS_AUTH === 'true' && token === process.env.DEV_ACCESS_TOKEN) {
            req.user = { uid: 'dev-user-id', email: 'dev@truxify.com' };
            return next();
        }

        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired access token' });
    }
};

module.exports = authMiddleware;
