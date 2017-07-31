(function() {
  'use strict';
  var MongoClient, ObjectId, async, asyncCallback, callbacks, cleanObj, convertWhere, database, maintenanceMode, ndx, objtrans, s, settings, syncCallback, version;

  MongoClient = require('mongodb').MongoClient;

  ObjectId = require('mongodb').ObjectId;

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
      if (key.indexOf('$') === 0 || key === '#') {
        delete obj[key];
      }
    }
  };

  convertWhere = function(where) {
    var walk;
    walk = function(base, current, route) {
      var item, key, newroute, obj, results1, type;
      if (current && current.hasOwnProperty('$like')) {
        current.$regex = ".*" + (current.$like || '') + ".*";
        current.$options = 'i';
        delete current.$like;
      }
      results1 = [];
      for (key in current) {
        obj = current[key];
        type = Object.prototype.toString.call(obj);
        if (type === '[object Object]') {
          if (key.indexOf('$') === 0) {
            results1.push(walk(obj, obj, ''));
          } else {
            newroute = route;
            if (newroute) {
              newroute += '.';
            }
            newroute += key;
            results1.push(walk(current, obj, newroute));
          }
        } else if (type === '[object Array]') {
          if (obj.length && Object.prototype.toString.call(obj[0]) === '[object Object]') {
            results1.push((function() {
              var i, len, results2;
              results2 = [];
              for (i = 0, len = obj.length; i < len; i++) {
                item = obj[i];
                results2.push(item = walk(item, item, ''));
              }
              return results2;
            })());
          } else {
            results1.push(void 0);
          }
        } else {
          if (key.indexOf('$') === 0) {
            results1.push(base[route][key] = obj);
          } else if (route) {
            newroute = route + '.' + key;
            base[newroute] = obj;
            results1.push(delete base[newroute.split(/\./g)[0]]);
          } else {
            if (key === '_id') {
              obj = new ObjectId(obj);
            }
            results1.push(base[key] = obj);
          }
        }
      }
      return results1;
    };
    walk(where, where, '');
    return where;
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
      if (settings.MONGO_URL) {
        MongoClient.connect(settings.MONGO_URL, settings.MONGO_OPTIONS, function(err, db) {
          if (err) {
            throw err;
          }
          database = db;
          console.log("ndx-mongo v" + version + " ready");
          return syncCallback('ready', database);
        });
      }
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
          var collection, myCb, options, sort, where;
          if (!result) {
            return typeof cb === "function" ? cb([], 0) : void 0;
          }
          args = args || {};
          ndx.user = user;
          myCb = function(err, output) {
            ndx.user = user;
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
              ndx.user = user;
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
          sort = {};
          if (args.sort) {
            sort[args.sort] = args.sortDir === 'DESC' ? -1 : 1;
          }
          where = args.where ? args.where : args;
          where = convertWhere(where);
          return collection.find(where, options).sort(sort).toArray(myCb);
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
          id: obj._id,
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
          delete obj._id;
          return collection.updateOne(whereObj, {
            $set: obj
          }, function(err, result) {
            ndx.user = user;
            asyncCallback((isServer ? 'serverUpdate' : 'update'), {
              id: obj._id,
              table: table,
              obj: obj,
              user: user,
              isServer: isServer
            });
            return typeof cb === "function" ? cb() : void 0;
          });
        });
      })(ndx.user);
    },
    insert: function(table, obj, cb, isServer) {
      cleanObj(obj);
      return (function(user) {
        ndx.user = user;
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
              var i, len, o;
              ndx.user = user;
              for (i = 0, len = obj.length; i < len; i++) {
                o = obj[i];
                asyncCallback((isServer ? 'serverInsert' : 'insert'), {
                  id: o._id,
                  table: table,
                  obj: o,
                  user: user,
                  isServer: isServer
                });
              }
              return typeof cb === "function" ? cb([]) : void 0;
            });
          } else {
            return collection.insertOne(obj, function(err, r) {
              ndx.user = user;
              asyncCallback((isServer ? 'serverInsert' : 'insert'), {
                id: obj._id,
                table: table,
                obj: obj,
                user: user,
                isServer: isServer
              });
              return typeof cb === "function" ? cb([]) : void 0;
            });
          }
        });
      })(ndx.user);
    },
    upsert: function(table, obj, whereObj, cb, isServer) {
      if (JSON.stringify(whereObj) !== '{}') {
        return this.update(table, obj, whereObj, cb, isServer);
      } else {
        return this.insert(table, obj, cb, isServer);
      }
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
            asyncCallback((isServer ? 'serverDelete' : 'delete'), {
              table: table,
              user: ndx.user,
              isServer: isServer
            });
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
      var outSlug, slug, testSlug;
      slug = s(ndx.fillTemplate(template, data)).prune(30, '').slugify().value();
      if (data.slug && data.slug.indexOf(slug) === 0) {
        return cb(true);
      }
      testSlug = slug;
      outSlug = null;
      return async.whilst(function() {
        return outSlug === null;
      }, (function(_this) {
        return function(callback) {
          return _this.select(table, {
            slug: testSlug
          }, function(results) {
            if (results && results.length) {
              testSlug = slug + '-' + Math.floor(Math.random() * 9999);
            } else {
              outSlug = testSlug;
            }
            return callback(null, outSlug);
          });
        };
      })(this), function(err, slug) {
        data.slug = slug;
        return typeof cb === "function" ? cb(true) : void 0;
      });
    },
    fieldFromTemplate: function(template, data, fieldName) {
      return data[fieldName] = ndx.fillTemplate(template, data);
    }
  };

}).call(this);

//# sourceMappingURL=index.js.map
