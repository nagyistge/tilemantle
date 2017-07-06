var fs = require('fs');
var async = require('async');
var sqlite3 = require('sqlite3');
var TransactionDatabase = require("sqlite3-transactions").TransactionDatabase;

function SQLite(opts) {
	this.options = opts;
	this.db = null;
}

SQLite.prototype.init = function(callback) {
	var self = this;
	var exists = false;
	var file = self.options.file;
	async.series([
		function checkExistence(callback) {
			if (!file) return callback(new Error('No "file" given for SQLite database'));
			if (file === ':memory:') return callback();
			fs.exists(file, function(result) {
				exists = result;
				callback();
			});
		},
		function createTables(callback) {
			self.db = new TransactionDatabase(new sqlite3.Database(file, function(err) {
				if (err) return callback(err);
				if (exists) return callback();
				var queries = [
					'CREATE TABLE queue(x INTEGER, y INTEGER, z INTEGER, preset TEXT, ts INTEGER)',
					'CREATE UNIQUE INDEX uniq ON queue (z,x,y,preset)'
				];
				async.eachSeries(queries, function(query, callback) {
					self.db.run(query, callback);
				}, callback);
			}));
		}
	], callback);
};

SQLite.prototype.select = function(z, xrange, yrange, opts, callback) {
	opts = opts || {};
	opts.limit = opts.limit || 500;
	var query = 'SELECT rowid AS id, x, y, z, preset, ts FROM queue WHERE z = ? AND (x BETWEEN ? AND ?) AND (y BETWEEN ? AND ?) LIMIT ?';
	this.db.all(query, [z, xrange[0], xrange[1], yrange[0], yrange[1], opts.limit], function(err, rows) {
		if (err) return callback(err);
		callback(null, rows);
	});
};

SQLite.prototype.take = function(callback) {
	var self = this;
	var item;

	this.db.beginTransaction(function(err, transaction) {
		if (err) return callback(err);
		async.series([
			function getItem(callback) {
				transaction.get('SELECT rowid AS id, x, y, z, preset, ts FROM queue', function(err, row) {
					item = row;
					callback(err);
				});
			},
			function deleteItem(callback) {
				if (!item) return callback();
				transaction.run('DELETE FROM queue WHERE rowid = ?', [item.id], callback);
			}
		], function(err) {
			transaction.commit(function(_err) {
				callback(err||_err, item);
			});
		})
	});
};

SQLite.prototype.insert = function(preset, x, y, z, callback) {
	this.db.run('INSERT INTO queue (x, y, z, preset, ts) VALUES (?, ?, ?, ?, ?)', [
		x, y, z, preset, Date.now()
	], function(err) {
		if (err && err.message.indexOf('UNIQUE constraint failed') > -1) {
			// ignore errors saying it's already in the queue
			return callback();
		}
		callback(err);
	});
};

SQLite.prototype.length = function(callback) {
	this.db.get('SELECT COUNT(*) AS count FROM queue', function(err, row) {
		if (err) return callback(err);
		callback(null, row.count);
	});
};

SQLite.prototype.reset = function(callback) {
	this.db.run('DELETE FROM queue', callback);
};

SQLite.prototype.beginTransaction = function(callback) {
	this.db.beginTransaction(function(err, transaction) {
		if(err) {
			callback(err);
		} else {
			callback(false, {
				insert: function(preset, x, y, z, callback) {
					transaction.run('INSERT INTO queue (x, y, z, preset, ts) VALUES (?, ?, ?, ?, ?)', [
						x, y, z, preset, Date.now()
					], function (err) {
						if (err && err.message.indexOf('UNIQUE constraint failed') > -1) {
							// ignore errors saying it's already in the queue
							return callback();
						}
						callback(err);
					})
				},
				commit: function(callback) {
					transaction.commit(callback);
				},
				rollback: function(callback) {
					transaction.rollback(callback);
				}
			});
		}
	});
};

module.exports = SQLite;