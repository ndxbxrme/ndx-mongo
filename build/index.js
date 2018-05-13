(function() {
  'use strict';
  var DeepDiff, MongoClient, ObjectId, algorithm, async, asyncCallback, callbacks, cleanObj, convertWhere, crypto, cryptojs, database, decryptObj, decryptString, encryptIgnore, encryptObj, encryptString, encryptWhere, maintenanceMode, minimatch, ndx, objtrans, readDiffs, s, select, selectOne, settings, syncCallback, unpack, useEncryption, version;

  MongoClient = require('mongodb').MongoClient;

  ObjectId = require('mongodb').ObjectId;

  async = require('async');

  minimatch = require('minimatch');

  crypto = require('crypto');

  cryptojs = require('crypto-js');

  algorithm = 'aes-256-ctr';

  objtrans = require('objtrans');

  settings = require('./settings');

  s = require('underscore.string');

  DeepDiff = require('deep-diff').diff;

  version = require('../package.json').version;

  database = null;

  ndx = {};

  maintenanceMode = false;

  useEncryption = false;

  encryptIgnore = ['**._id'];

  callbacks = {
    ready: [],
    insert: [],
    update: [],
    select: [],
    delete: [],
    preInsert: [],
    preUpdate: [],
    preSelect: [],
    preDelete: [],
    selectTransform: [],
    serverSelectTransform: [],
    restore: []
  };

  syncCallback = function(name, obj, cb) {
    var callback, j, len, ref;
    if (callbacks[name] && callbacks[name].length) {
      ref = callbacks[name];
      for (j = 0, len = ref.length; j < len; j++) {
        callback = ref[j];
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

  encryptString = function(str) {
    if (str) {
      return cryptojs.AES.encrypt(str, settings.ENCRYPTION_KEY || settings.SESSION_SECRET).toString();
    }
    return null;
  };

  decryptString = function(str) {
    if (str) {
      return cryptojs.AES.decrypt(str, settings.ENCRYPTION_KEY || settings.SESSION_SECRET).toString(cryptojs.enc.Utf8);
    }
    return '';
  };

  encryptObj = function(obj, path) {
    var ignore, j, key, len, myobj, type;
    myobj = {};
    for (j = 0, len = encryptIgnore.length; j < len; j++) {
      ignore = encryptIgnore[j];
      if (minimatch(path, ignore)) {
        return obj;
      }
    }
    type = Object.prototype.toString.call(obj);
    if (type === '[object Object]') {
      for (key in obj) {
        myobj[key] = encryptObj(obj[key], `${path}.${key}`);
      }
    } else if (type === '[object Boolean]') {
      return obj;
    } else {
      return encryptString(JSON.stringify(obj));
    }
    return myobj;
  };

  decryptObj = function(obj, path) {
    var ignore, j, key, len, type;
    for (j = 0, len = encryptIgnore.length; j < len; j++) {
      ignore = encryptIgnore[j];
      if (minimatch(path, ignore)) {
        return obj;
      }
    }
    type = Object.prototype.toString.call(obj);
    if (type === '[object Object]') {
      for (key in obj) {
        obj[key] = decryptObj(obj[key], `${path}.${key}`);
      }
    } else if (type === '[object Boolean]') {
      return obj;
    } else {
      if (!obj) {
        return obj;
      }
      return JSON.parse(decryptString(obj));
    }
    return obj;
  };

  encryptWhere = function(obj, path) {
    var ignore, j, key, len, mypath, type;
    type = Object.prototype.toString.call(obj);
    for (j = 0, len = encryptIgnore.length; j < len; j++) {
      ignore = encryptIgnore[j];
      if (minimatch(path, ignore)) {
        return obj;
      }
    }
    if (type === '[object Object]') {
      for (key in obj) {
        mypath = path;
        if (key.indexOf('$') !== 0) {
          mypath = `${path}.${key}`;
        }
        obj[key] = encryptWhere(obj[key], mypath);
      }
    } else if (type === '[object Boolean]') {
      return obj;
    } else {
      return encryptString(JSON.stringify(obj));
    }
    return obj;
  };

  cleanObj = function(obj) {
    var key;
    for (key in obj) {
      if (key.indexOf('$') === 0 || key === '#') {
        delete obj[key];
      } else if (Object.prototype.toString.call(obj[key]) === '[object Object]') {
        cleanObj(obj[key]);
      }
    }
  };

  readDiffs = function(from, to, out) {
    var dif, diffs, good, j, len, myout, mypath;
    diffs = DeepDiff(from, to);
    out = out || {};
    for (j = 0, len = diffs.length; j < len; j++) {
      dif = diffs[j];
      switch (dif.kind) {
        case 'E':
        case 'N':
          myout = out;
          mypath = dif.path.join('.');
          good = true;
          if (dif.lhs && dif.rhs && typeof dif.lhs !== typeof dif.rhs) {
            if (dif.lhs.toString() === dif.rhs.toString()) {
              good = false;
            }
          }
          if (good) {
            myout[mypath] = {};
            myout = myout[mypath];
            myout.from = dif.lhs;
            myout.to = dif.rhs;
          }
      }
    }
    return out;
  };

  unpack = function(diffs, out) {
    var bit, bits, i, j, key, len, myout;
    out = out || {};
    for (key in diffs) {
      bits = key.split(/\./g);
      myout = out;
      for (i = j = 0, len = bits.length; j < len; i = ++j) {
        bit = bits[i];
        if (!myout[bit]) {
          if (i < bits.length - 1) {
            myout[bit] = {};
          } else {
            myout[bit] = diffs[key];
          }
        }
        myout = myout[bit];
      }
    }
    return out;
  };

  convertWhere = function(where) {
    var walk;
    walk = function(base, current, route) {
      var item, key, newroute, obj, results1, type;
      if (current && current.hasOwnProperty('$like')) {
        current.$regex = `.*${current.$like || ''}.*`;
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
              var j, len, results2;
              results2 = [];
              for (j = 0, len = obj.length; j < len; j++) {
                item = obj[j];
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
            if (key === '_id' || newroute === '_id') {
              obj = new ObjectId(obj);
            }
            results1.push(base[key] = obj);
          }
        }
      }
      return results1;
    };
    walk(where, where, '');
    delete where['#'];
    return where;
  };

  select = function(table, args, cb, isServer) {
    return new Promise(function(resolve, reject) {
      var cacheResult;
      if (ndx.cache && (cacheResult = ndx.cache.get(table, args, ndx.user))) {
        resolve(cacheResults.output);
        return typeof cb === "function" ? cb(cacheResult.output, cacheResult.total) : void 0;
      }
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreSelect' : 'preSelect'), {
          pre: true,
          table: table,
          args: args,
          user: user
        }, function(result) {
          var collection, myCb, options, sort, where;
          if (!result) {
            resolve([]);
            return typeof cb === "function" ? cb([], 0) : void 0;
          }
          args = args || {};
          ndx.user = user;
          myCb = function(err, output) {
            ndx.user = user;
            if (err) {
              resolve([]);
              return typeof cb === "function" ? cb([], 0) : void 0;
            }
            return asyncCallback((isServer ? 'serverSelect' : 'select'), {
              post: true,
              table: table,
              objs: output,
              isServer: isServer,
              user: user
            }, function() {
              var j, len, obj, total;
              ndx.user = user;
              total = output.length;
              if (args.page || args.pageSize) {
                args.page = args.page || 1;
                args.pageSize = args.pageSize || 10;
                output = output.splice((args.page - 1) * args.pageSize, args.pageSize);
              }
              if (useEncryption) {
                for (j = 0, len = output.length; j < len; j++) {
                  obj = output[j];
                  obj = decryptObj(obj, table);
                }
              }
              return asyncCallback((isServer ? 'serverSelectTransform' : 'selectTransform'), {
                transform: args.transform,
                table: table,
                objs: output,
                isServer: isServer,
                user: user
              }, function() {
                ndx.user = user;
                ndx.cache && ndx.cache.set(table, args, user, {
                  output: output,
                  total: total
                });
                resolve(output);
                return typeof cb === "function" ? cb(output, total) : void 0;
              });
            });
          };
          collection = database.collection(table);
          options = {};
          sort = {};
          if (args.sort) {
            if (typeof args.sort === 'string') {
              sort[args.sort] = args.sortDir === 'DESC' ? -1 : 1;
            } else {
              sort = args.sort;
            }
          }
          where = args.where ? args.where : args;
          where = convertWhere(where);
          //if useEncryption
          //  where = encryptWhere where, table
          return collection.find(where, options).sort(sort).toArray(myCb);
        });
      })(ndx.user);
    });
  };

  selectOne = async function(table, args, cb, isServer) {
    var output;
    output = (await select(table, args, null, isServer));
    if (output && output.length) {
      return output[0];
    } else {
      return null;
    }
  };

  module.exports = {
    config: function(config) {
      var key, keyU;
      for (key in config) {
        keyU = s(key).underscored().value().toUpperCase();
        settings[keyU] = config[key] || config[keyU] || settings[keyU];
      }
      if (settings.ENCRYPT_IGNORE) {
        encryptIgnore = settings.ENCRYPT_IGNORE;
      }
      if (settings.ENCRYPT_MONGO) {
        useEncryption = true;
      }
      settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
      return this;
    },
    start: function() {
      if (settings.MONGO_URL) {
        MongoClient.connect(settings.MONGO_URL, settings.MONGO_OPTIONS, function(err, db) {
          if (err) {
            throw err;
          }
          database = db;
          console.log(`ndx-mongo v${version} ready`);
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
    select: select,
    selectOne: selectOne,
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
        var collection;
        collection = database.collection(table);
        return collection.find(whereObj, {}).toArray(function(err, oldItems) {
          var ids;
          if (!err && oldItems) {
            ids = [];
            return async.each(oldItems, function(oldItem, diffCb) {
              var diffs, newObj;
              if (useEncryption) {
                oldItem = decryptObj(oldItem, table);
              }
              diffs = readDiffs(oldItem, unpack(obj));
              newObj = {};
              Object.assign(newObj, oldItem);
              Object.assign(newObj, obj);
              return asyncCallback((isServer ? 'serverPreUpdate' : 'preUpdate'), {
                pre: true,
                id: oldItem._id.toString(),
                table: table,
                where: whereObj,
                obj: obj,
                oldObj: oldItem,
                newObj: newObj,
                changes: diffs,
                user: user
              }, function(result) {
                var id;
                if (!result) {
                  return diffCb();
                }
                ndx.cache && ndx.cache.reset(table);
                ndx.user = user;
                id = oldItem._id.toString();
                delete obj._id;
                return collection.updateOne({
                  _id: oldItem._id
                }, {
                  $set: useEncryption ? encryptObj(obj, table) : obj
                }, function(err, result) {
                  ndx.user = user;
                  asyncCallback((isServer ? 'serverUpdate' : 'update'), {
                    post: true,
                    id: id,
                    table: table,
                    obj: obj,
                    oldObj: oldItem,
                    newObj: newObj,
                    changes: diffs,
                    user: user,
                    isServer: isServer
                  });
                  ids.push(result.insertedId);
                  return diffCb();
                });
              });
            }, function() {
              return typeof cb === "function" ? cb(err, {
                op: 'update',
                id: ids
              }) : void 0;
            });
          } else {
            return typeof cb === "function" ? cb('nothing to update', {
              op: 'update',
              id: null
            }) : void 0;
          }
        });
      })(ndx.user);
    },
    insert: function(table, obj, cb, isServer) {
      cleanObj(obj);
      return (function(user) {
        ndx.user = user;
        return asyncCallback((isServer ? 'serverPreInsert' : 'preInsert'), {
          pre: true,
          table: table,
          obj: obj,
          user: user
        }, function(result) {
          var collection;
          if (!result) {
            return typeof cb === "function" ? cb([]) : void 0;
          }
          ndx.cache && ndx.cache.reset(table);
          ndx.user = user;
          collection = database.collection(table);
          if (obj._id && Object.prototype.toString.call(obj._id) === '[object String]') {
            obj._id = new ObjectId(obj._id);
          }
          if (Object.prototype.toString.call(obj) === '[object Array]') {
            return async.each(obj, function(o, callback) {
              return collection.insertOne((useEncryption ? encryptObj(o, table) : o), function(err, r) {
                ndx.user = user;
                o._id = r.insertedId;
                asyncCallback((isServer ? 'serverInsert' : 'insert'), {
                  post: true,
                  id: o._id,
                  table: table,
                  obj: o,
                  user: user,
                  isServer: isServer
                });
                if (typeof cb === "function") {
                  cb(err, {
                    op: 'insert',
                    id: r.insertedId
                  });
                }
                return callback();
              });
            });
          } else {
            return collection.insertOne((useEncryption ? encryptObj(obj, table) : obj), function(err, r) {
              ndx.user = user;
              obj._id = r.insertedId;
              asyncCallback((isServer ? 'serverInsert' : 'insert'), {
                post: true,
                id: obj._id,
                table: table,
                obj: obj,
                user: user,
                isServer: isServer
              });
              return typeof cb === "function" ? cb(err, {
                op: 'insert',
                id: r.insertedId
              }) : void 0;
            });
          }
        });
      })(ndx.user);
    },
    upsert: function(table, obj, whereObj, cb, isServer) {
      var where;
      where = convertWhere(JSON.parse(JSON.stringify(whereObj)));
      if ((!whereObj || JSON.stringify(whereObj) === '{}') && obj._id) {
        whereObj = {};
        whereObj._id = obj._id.toString();
        where = convertWhere(JSON.parse(JSON.stringify(whereObj)));
      }
      return ((user) => {
        var collection;
        if (!whereObj || JSON.stringify(whereObj) === '{}') {
          return this.insert(table, obj, cb, isServer);
        }
        collection = database.collection(table);
        return collection.find(where).toArray((err, test) => {
          if (test && test.length) {
            return this.update(table, obj, whereObj, cb, isServer);
          } else {
            return this.insert(table, obj, cb, isServer);
          }
        });
      /*
      if JSON.stringify(whereObj) isnt '{}'
      */
      })(ndx.user);
    },
    delete: function(table, whereObj, cb, isServer) {
      var where;
      whereObj = convertWhere(whereObj);
      if (useEncryption) {
        where = encryptWhere(where, table);
      }
      return (function(user) {
        return asyncCallback((isServer ? 'serverPreDelete' : 'preDelete'), {
          pre: true,
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
          ndx.cache && ndx.cache.reset(table);
          ndx.user = user;
          collection = database.collection(table);
          return collection.deleteMany(whereObj, null, function() {
            asyncCallback((isServer ? 'serverDelete' : 'delete'), {
              post: true,
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
      }, (callback) => {
        return this.select(table, {
          slug: testSlug
        }, function(results) {
          if (results && results.length) {
            testSlug = slug + '-' + Math.floor(Math.random() * 9999);
          } else {
            outSlug = testSlug;
          }
          return callback(null, outSlug);
        }, true);
      }, function(err, slug) {
        data.slug = slug;
        return typeof cb === "function" ? cb(true) : void 0;
      });
    },
    fieldFromTemplate: function(template, data, fieldName) {
      return data[fieldName] = ndx.fillTemplate(template, data);
    },
    decryptObj: decryptObj,
    stats: function(cb) {
      return database.command({
        dbStats: 1
      }, function(err, result) {
        return cb(err, result);
      });
    },
    cacheSize: function() {
      return 0;
    }
  };

}).call(this);

//# sourceMappingURL=index.js.map
