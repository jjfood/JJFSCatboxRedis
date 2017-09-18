
'use strict';

// Load modules

const Redis = require('ioredis');
const Hoek = require('hoek');


// Declare internals

var internals = {};

internals.defaults = {
    host: '127.0.0.1',
    port: 6379
};


exports = module.exports = internals.Connection = function (options) {

    Hoek.assert(this.constructor === internals.Connection, 'Redis cache client must be instantiated using new');

    this.settings = Object.assign({}, internals.defaults, options);
    this.client = options.client || null;
    return this;
};


internals.Connection.prototype.start = function (callback) {

    callback = Hoek.once(callback);

    var self = this;
    if (this.client) {
        return Hoek.nextTick(callback)();
    }

    var client;

    const options = {
        password: this.settings.password,
        db: this.settings.database || this.settings.db,
        tls: this.settings.tls
    };

    if (this.settings.sentinels && this.settings.sentinels.length) {
        options.sentinels = this.settings.sentinels;
        options.name = this.settings.sentinelName;
        client = Redis.createClient(this.settings);
    }
    else if(this.settings.tls) {
        options.tls = this.settings.tls;
        client = Redis.createClient(this.settings.tls, this.settings);
    }
    else if (this.settings.url) {
        client = Redis.createClient(this.settings.url,this.settings);
    }
    else if (this.settings.socket) {
        client = Redis.createClient(this.settings.socket, this.settings);
    }
    else {

        client = Redis.createClient(this.settings.port, this.settings.host, this.settings);
    }

    console.log(client)

    // Listen to errors

    client.on('error', function (err) {

        if (!self.client) {                             // Failed to connect
            client.end(false);
            return callback(err);
        }
    });

    // Wait for connection

    client.once('ready', function () {

        self.client = client;
        return callback();
    });
};


internals.Connection.prototype.stop = function () {

    if (this.client) {
        this.client.removeAllListeners();
        this.client.quit();
        this.client = null;
    }
};


internals.Connection.prototype.isReady = function () {

    return !!this.client;
};


internals.Connection.prototype.validateSegmentName = function (name) {

    if (!name) {
        return new Error('Empty string');
    }

    if (name.indexOf('\0') !== -1) {
        return new Error('Includes null character');
    }

    return null;
};


internals.Connection.prototype.get = function (key, callback) {

    if (!this.client) {
        return callback(new Error('Connection not started'));
    }

    this.client.get(this.generateKey(key), function (err, result) {

        if (err) {
            return callback(err);
        }

        if (!result) {
            return callback(null, null);
        }

        var envelope = null;
        try {
            envelope = JSON.parse(result);
        }
        catch (err) { }     // Handled by validation below

        if (!envelope) {
            return callback(new Error('Bad envelope content'));
        }

        if (!envelope.item ||
            !envelope.stored) {

            return callback(new Error('Incorrect envelope structure'));
        }

        return callback(null, envelope);
    });
};


internals.Connection.prototype.set = function (key, value, ttl, callback) {

    var self = this;

    if (!this.client) {
        return callback(new Error('Connection not started'));
    }

    var envelope = {
        item: value,
        stored: Date.now(),
        ttl
    };

    var cacheKey = this.generateKey(key);

    var stringifiedEnvelope = null;

    try {
        stringifiedEnvelope = JSON.stringify(envelope);
    }
    catch (err) {
        return callback(err);
    }

    this.client.set(cacheKey, stringifiedEnvelope, function (err) {

        if (err) {
            return callback(err);
        }

        var ttlSec = Math.max(1, Math.floor(ttl / 1000));
        self.client.expire(cacheKey, ttlSec, function (err) {        // Use 'pexpire' with ttl in Redis 2.6.0

            return callback(err);
        });
    });
};


internals.Connection.prototype.drop = function (key, callback) {

    if (!this.client) {
        return callback(new Error('Connection not started'));
    }

    this.client.del(this.generateKey(key), function (err) {

        return callback(err);
    });
};


internals.Connection.prototype.generateKey = function (key) {

    const parts = [];

    if (this.settings.partition) {
        parts.push(encodeURIComponent(this.settings.partition));
    }

    parts.push(encodeURIComponent(key.segment));
    parts.push(encodeURIComponent(key.id));

    return parts.join(':');
};
