const axios = require('axios');
const protoHandler = require('./protobuf');
const { AE, HEADERS, URLS, GARENA_CLIENT, DEFAULT_CREDENTIALS } = require('./constants');
const { processPlayerItems } = require('./utils');

class FreeFireAPI {
    constructor() {
        this.session = {
            token: null,
            serverUrl: null,
            openId: null,
            accountId: null
        };
    }

    /**
     * Authenticate with Garena using UID and Password (Guest/Account)
     * @param {string} [uid] - (Optional) User ID
     * @param {string} [password] - (Optional) Password
     */
    async login(uid = null, password = null) {
        // Use default credentials if not provided
        if (!uid || !password) {
            console.log("[i] No credentials provided, loading from config/credentials.yaml.");
            uid = DEFAULT_CREDENTIALS.UID;
            password = DEFAULT_CREDENTIALS.PASSWORD;
        }

        if (!uid || !password) {
            throw new Error("Missing credentials. Set UID and PASSWORD in config/credentials.yaml or pass them to login(uid, password).");
        }

        // Step 1: Get Garena Token
        const garenaData = await this._getGarenaToken(uid, password);
        if (!garenaData || !garenaData.access_token) {
            throw new Error("Garena authentication failed: Invalid credentials or response");
        }

        // Step 2: Major Login
        const loginData = await this._majorLogin(garenaData.access_token, garenaData.open_id);
        if (!loginData || !loginData.token) {
            throw new Error("Major login failed: Empty token received");
        }

        this.session.token = loginData.token;
        this.session.serverUrl = loginData.serverUrl;
        this.session.openId = garenaData.open_id;
        this.session.accountId = loginData.accountid;

        return this.session;
    }

    async _getGarenaToken(uid, password) {
        const params = new URLSearchParams();
        params.append('uid', uid);
        params.append('password', password);
        params.append('response_type', 'token');
        params.append('client_type', '2');
        params.append('client_secret', GARENA_CLIENT.CLIENT_SECRET);
        params.append('client_id', GARENA_CLIENT.CLIENT_ID);

        try {
            const response = await axios.post(URLS.GARENA_TOKEN, params, {
                headers: HEADERS.GARENA_AUTH
            });
            return response.data;
        } catch (error) {
            throw new Error(`Garena Auth Request Failed: ${error.message}`);
        }
    }

    async _majorLogin(accessToken, openId) {
        const payload = {
            openid: openId,
            logintoken: accessToken,
            platform: "4"
        };

        const encryptedBody = await protoHandler.encode('MajorLogin.proto', 'request', payload, true);

        try {
            const response = await axios.post(URLS.MAJOR_LOGIN, encryptedBody, {
                headers: {
                    ...HEADERS.COMMON,
                    'Authorization': 'Bearer', // Specific to MajorLogin
                    'Content-Type': 'application/octet-stream'
                },
                responseType: 'arraybuffer'
            });

            return await protoHandler.decode('MajorLogin.proto', 'response', response.data);
        } catch (error) {
            throw new Error(`Major Login Request Failed: ${error.message}`);
        }
    }

    /**
     * Search for accounts by name (fuzzy search)
     * @param {string} keyword 
     * @returns {Promise<Array>} List of matching accounts
     */
    async searchAccount(keyword) {
        await this._checkSession();

        if (keyword.length < 3) {
            throw new Error("Search keyword must be at least 3 characters long.");
        }

        const payload = { keyword: String(keyword) };
        const encryptedBody = await protoHandler.encode('SearchAccountByName.proto', 'SearchAccountByName.request', payload, true);

        const url = URLS.SEARCH(this.session.serverUrl);

        try {
            const response = await axios.post(url, encryptedBody, {
                headers: {
                    ...HEADERS.COMMON,
                    'Authorization': `Bearer ${this.session.token}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                responseType: 'arraybuffer'
            });

            const data = await protoHandler.decode('SearchAccountByName.proto', 'SearchAccountByName.response', response.data);
            return data.infos; // Field name is 'infos' in proto
        } catch (error) {
            throw new Error(`Search Failed: ${error.message}`);
        }
    }

    /**
     * Get detailed player profile (Personal Show)
     * @param {number|string} uid 
     * @returns {Promise<Object>} Player data including profile, guild, etc.
     */
    async getPlayerProfile(uid) {
        await this._checkSession();

        const payload = {
            accountId: Number(uid),
            callSignSrc: 7,
            needGalleryInfo: true
        };

        const encryptedBody = await protoHandler.encode('PlayerPersonalShow.proto', 'request', payload, true);
        const url = URLS.PERSONAL_SHOW(this.session.serverUrl);

        try {
            const response = await axios.post(url, encryptedBody, {
                headers: {
                    ...HEADERS.COMMON,
                    'Authorization': `Bearer ${this.session.token}`
                },
                responseType: 'arraybuffer'
            });

            return await protoHandler.decode('PlayerPersonalShow.proto', 'response', response.data);
        } catch (error) {
            throw new Error(`Get Profile Failed: ${error.message}`);
        }
    }

    /**
     * Get player items (outfit, weapons, skills, pet)
     * @param {number|string} uid 
     */
    async getPlayerItems(uid) {
        const profile = await this.getPlayerProfile(uid);
        if (!profile) return null;
        return processPlayerItems(profile);
    }

    /**
     * Get Player Stats
     * @param {number|string} uid 
     * @param {'br'|'cs'} mode - Battle Royale or Clash Squad
     * @param {'career'|'ranked'|'normal'} matchType 
     */
    async getPlayerStats(uid, mode = 'br', matchType = 'career') {
        await this._checkSession();

        const modeLower = mode.toLowerCase();
        const typeUpper = matchType.toUpperCase();

        let matchMode = 0;
        let url = '';
        let protoFile = '';
        let payload = { accountid: Number(uid) };

        if (modeLower === 'br') {
            const types = { 'CAREER': 0, 'NORMAL': 1, 'RANKED': 2 };
            matchMode = types[typeUpper] !== undefined ? types[typeUpper] : 0;
            url = URLS.PLAYER_STATS(this.session.serverUrl);
            protoFile = 'PlayerStats.proto';
            payload.matchmode = matchMode;
        } else {
            const types = { 'CAREER': 0, 'NORMAL': 1, 'RANKED': 6 };
            matchMode = types[typeUpper] !== undefined ? types[typeUpper] : 0;
            url = URLS.PLAYER_CS_STATS(this.session.serverUrl);
            protoFile = 'PlayerCSStats.proto';
            payload.gamemode = 15; // CS default
            payload.matchmode = matchMode;
        }

        const encryptedBody = await protoHandler.encode(protoFile, 'request', payload, true);

        try {
            const response = await axios.post(url, encryptedBody, {
                headers: {
                    ...HEADERS.COMMON,
                    'Authorization': `Bearer ${this.session.token}`
                },
                responseType: 'arraybuffer'
            });

            return await protoHandler.decode(protoFile, 'response', response.data);
        } catch (error) {
            throw new Error(`Get Stats Failed: ${error.message}`);
        }
    }
    // ----- Auto login if no session with Default Data.
    async _checkSession() {
        if (!this.session.token || !this.session.serverUrl) {
            await this.login();
        }
    }
}

module.exports = FreeFireAPI;
