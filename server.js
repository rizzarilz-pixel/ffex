

const express = require('express');
const bodyParser = require('body-parser');
const Api = require('./lib/api');

const app = express();
app.use(bodyParser.json());

const api = new Api();

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'FreeFire API Express Running' });
});

// Login endpoint
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await api.login(username, password);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search player
app.get('/search', async (req, res) => {
    try {
        const { name } = req.query;
        const result = await api.search(name);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Profile
app.get('/profile/:uid', async (req, res) => {
    try {
        const result = await api.getProfile(req.params.uid);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stats
app.get('/stats/:uid', async (req, res) => {
    try {
        const result = await api.getStats(req.params.uid);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

