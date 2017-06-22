(function() {
  'use strict';
  var MongoClient, async, asyncCallback, callbacks, cleanObj, convertWhere, database, maintenanceMode, ndx, objtrans, s, settings, syncCallback, version;

  MongoClient = require('mongodb').MongoClient;

  async = require('async');

  objtrans = require('objtrans');

  settings = require('./settings');

  s = require('underscore.string');

  version = require('../package.json').version;

  database = null;

  ndx = {};

  maintenanceMode = false;

  callbacks = {
    ready: [],
    insert: [],
    update: [],
    select: [],
    "delete": [],
    preInsert: [],
    preUpdate: [],
    preSelect: [],
    preDelete: [],
    restore: []
  };

  syncCallback = function(name, obj, cb) {
    var callback, i, len, ref;
    if (callbacks[name] && callbacks[name].length) {
      ref = callbacks[name];
      for (i = 0, len = ref.length; i < len; i++) {
        callback = ref[i];
        callback(obj);
      }
    }
    return typeof cb === "function" ? cb() : void 0;
  };

  asyncCallback = function(name, obj, cb) {
    var truth;
    truth = false;
    if (callbacks[name] && callbacks[name].length) {
      return async.eachSeries(callbacks[name], function(cbitem, callback) {
        return cbitem(obj, function(result) {
          truth = truth || result;
          return callback();
        });
      }, function() {
        return typeof cb === "function" ? cb(truth) : void 0;
      });
    } else {
      return typeof cb === "function" ? cb(true) : void 0;
    }
  };

  cleanObj = function(obj) {
    var key;
    for (key in obj) {
      if (key.indexOf('$') === 0) {
        delete obj[key];
      }
    }
  };

  convertWhere = function(obj) {
    var output, walk;
    output = {};
    walk = function(obj, route, output) {
      var key, results1;
      results1 = [];
      for (key in obj) {
        if (key === '$like') {
          results1.push(output[route] = {
            $regex: ".*" + (obj[key] || '') + ".*",
            $options: 'i'
          });
        } else if (key.indexOf('$') === 0) {
          output[key] = {};
          results1.push(walk(obj[key], route, output[key]));
        } else if (Object.prototype.toString.call(obj[key]) === '[object Object]') {
          results1.push(walk(obj[key], route + ("." + key), output));
        } else {
          results1.push(output[(route + ("." + key)).replace(/^\./, '')] = obj[key]);
        }
      }
      return results1;
    };
    walk(obj, '', output);
    return output;
  };

  module.exports = {
    config: function(config) {
      var key, keyU;
      for (key in config) {
        keyU = s(key).underscored().value().toUpperCase();
        settings[keyU] = config[key] || config[keyU] || settings[keyU];
      }
      return this;
    },
    start: function() {
      MongoClient.connect(settings.MONGO_URL, settings.MONGO_OPTIONS, function(err, db) {
        if (err) {
          throw err;
        }
        database = db;
        console.log("ndx-mongo v" + version + " ready");
        return syncCallback('ready', database);
      });
      return this;
    },
    on: function(name, callback) {
      callbacks[name].push(callback);
      return this;
    },
    off: function(name, callback) {
      callbacks[name].splice(callbacks[name].indexOf(callback), 1);
      return this;
    },
    select: function(table, args, cb, isServer) {
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreSelect' : 'preSelect'), {
          table: table,
          args: args,
          user: user
        }, function(result) {
          var collection, myCb, options, where;
          if (!result) {
            return typeof cb === "function" ? cb([], 0) : void 0;
          }
          args = args || {};
          ndx.user = user;
          myCb = function(err, output) {
            if (err) {
              return typeof cb === "function" ? cb([], 0) : void 0;
            }
            return asyncCallback((isServer ? 'serverSelect' : 'select'), {
              table: table,
              objs: output,
              isServer: isServer,
              user: user
            }, function() {
              var total;
              total = output.length;
              if (args.page || args.pageSize) {
                args.page = args.page || 1;
                args.pageSize = args.pageSize || 10;
                output = output.splice((args.page - 1) * args.pageSize, args.pageSize);
              }
              return typeof cb === "function" ? cb(output, total) : void 0;
            });
          };
          collection = database.collection(table);
          options = {};
          where = args.where ? args.where : args;
          where = convertWhere(where);
          return collection.find(where, options).toArray(myCb);
        });
      })(ndx.user);
    },
    count: function(table, whereObj, cb) {
      var collection;
      whereObj = convertWhere(whereObj);
      collection = database.collection(table);
      return collection.count(whereObj, function(err, count) {
        return typeof cb === "function" ? cb(count) : void 0;
      });
    },
    update: function(table, obj, whereObj, cb, isServer) {
      whereObj = convertWhere(whereObj);
      cleanObj(obj);
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreUpdate' : 'preUpdate'), {
          id: getId(obj),
          table: table,
          obj: obj,
          where: whereObj,
          user: user
        }, function(result) {
          var collection;
          if (!result) {
            return typeof cb === "function" ? cb([]) : void 0;
          }
          ndx.user = user;
          collection = database.collection(table);
          return collection.updateOne(whereObj, {
            $set: obj
          }, function(err, result) {
            return typeof cb === "function" ? cb() : void 0;
          });
        });
      })(ndx.user);
    },
    insert: function(table, obj, cb, isServer) {
      cleanObj(obj);
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreInsert' : 'preInsert'), {
          table: table,
          obj: obj,
          user: user
        }, function(result) {
          var collection;
          if (!result) {
            return typeof cb === "function" ? cb([]) : void 0;
          }
          ndx.user = user;
          collection = database.collection(table);
          if (Object.prototype.toString.call(obj) === '[object Array]') {
            return collection.insertMany(obj, function(err, r) {
              return typeof cb === "function" ? cb([]) : void 0;
            });
          } else {
            return collection.insertOne(obj, function(err, r) {
              return typeof cb === "function" ? cb([]) : void 0;
            });
          }
        });
      })(ndx.user);
    },
    upsert: function(table, obj, whereObj, cb, isServer) {
      var collection;
      whereObj = convertWhere(whereObj);
      collection = database.collection(table);
      return collection.findOne(whereObj, (function(_this) {
        return function(err, result) {
          if (!err && result) {
            return _this.update(table, obj, whereObj, cb, isServer);
          } else {
            return _this.insert(table, obj, cb, isServer);
          }
        };
      })(this));
    },
    "delete": function(table, whereObj, cb, isServer) {
      whereObj = convertWhere(whereObj);
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreDelete' : 'preDelete'), {
          table: table,
          where: whereObj,
          user: user
        }, function(result) {
          var collection;
          if (!result) {
            if (typeof cb === "function") {
              cb([]);
            }
          }
          ndx.user = user;
          collection = database.collection(table);
          return collection.deleteMany(whereObj, null, function() {
            return typeof cb === "function" ? cb() : void 0;
          });
        });
      })(ndx.user);
    },
    maintenanceOn: function() {
      return maintenanceMode = true;
    },
    maintenanceOff: function() {
      return maintenanceMode = false;
    },
    version: function() {
      return version;
    },
    maintenance: function() {
      return maintenanceMode;
    },
    setNdx: function(_ndx) {
      ndx = _ndx;
      return this;
    },
    makeSlug: function(table, template, data, cb) {
      var slug;
      slug = s(ndx.fillTemplate(template, data)).prune(30, '').slugify().value();
      return this.select(table, {
        slug: slug
      }, function(results) {
        if (results.length) {
          slug = slug + Math.floor(Math.random() * 9999);
        }
        data.slug = slug;
        return typeof cb === "function" ? cb(true) : void 0;
      });
    }
  };

}).call(this);

//# sourceMappingURL=index.js.map
