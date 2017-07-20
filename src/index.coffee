'use strict'

MongoClient = require 'mongodb'
.MongoClient
ObjectId = require 'mongodb'
.ObjectId
async = require 'async'
objtrans = require 'objtrans'
settings = require './settings'
s = require('underscore.string')
version = require('../package.json').version
database = null
ndx = {}
maintenanceMode = false
callbacks =
  ready: []
  insert: []
  update: []
  select: []
  delete: []
  preInsert: []
  preUpdate: []
  preSelect: []
  preDelete: []
  restore: []
syncCallback = (name, obj, cb) ->
  if callbacks[name] and callbacks[name].length
    for callback in callbacks[name]
      callback obj
  cb?()
asyncCallback = (name, obj, cb) ->
  truth = false
  if callbacks[name] and callbacks[name].length
    async.eachSeries callbacks[name], (cbitem, callback) ->
      cbitem obj, (result) ->
        truth = truth or result
        callback()
    , ->
      cb? truth
  else
    cb? true
cleanObj = (obj) ->
  for key of obj
    if key.indexOf('$') is 0
      delete obj[key]
  return
convertWhere = (obj) ->
  output = {}
  walk = (obj, route, output) ->
    for key of obj
      if key is '$like'
        output[route.replace(/^\./, '')] =
          $regex: ".*#{obj[key] or ''}.*"
          $options: 'i'
      else if key.indexOf('$') is 0
        myroute = route.replace(/^\./, '')
        output[myroute] = {}
        output[myroute][key] = {}
        if Object.prototype.toString.call(obj[key]) is '[object Object]'
          walk obj[key], myroute, output[myroute]
        else
          output[myroute][key] = obj[key]
      else if Object.prototype.toString.call(obj[key]) is '[object Object]' and not obj[key]._bsontype
        walk obj[key], route + ".#{key}", output
      else
        outkey = (route + ".#{key}").replace(/^\./, '')
        output[outkey] = if outkey is '_id' and not obj[key]._bsontype then (new ObjectId(obj[key])) else obj[key]
  walk obj, '', output
  output
module.exports =
  config: (config) ->
    for key of config
      keyU = s(key).underscored().value().toUpperCase()
      settings[keyU] = config[key] or config[keyU] or settings[keyU]
    @
  start: ->
    if settings.MONGO_URL
      MongoClient.connect settings.MONGO_URL, settings.MONGO_OPTIONS, (err, db) ->
        if err
          throw err
        database = db
        console.log "ndx-mongo v#{version} ready"
        syncCallback 'ready', database
    @
  on: (name, callback) ->
    callbacks[name].push callback
    @
  off: (name, callback) ->
    callbacks[name].splice callbacks[name].indexOf(callback), 1
    @
  select: (table, args, cb, isServer) ->
    #todo $like and sorting
    ((user) ->
      asyncCallback (if isServer then 'serverPreSelect' else 'preSelect'), 
        table: table
        args: args
        user: user
      , (result) ->
        if not result
          return cb? [], 0
        args = args or {}
        ndx.user = user
        myCb = (err, output) ->
          ndx.user = user
          if err
            return cb? [], 0
          asyncCallback (if isServer then 'serverSelect' else 'select'), 
            table: table
            objs: output
            isServer: isServer
            user: user
          , ->
            ndx.user = user
            total = output.length
            if args.page or args.pageSize
              args.page = args.page or 1
              args.pageSize = args.pageSize or 10
              output = output.splice (args.page - 1) * args.pageSize, args.pageSize
            cb? output, total
        collection = database.collection table
        options = {}
        sort = {}
        if args.sort
          sort[args.sort] = if args.sortDir is 'DESC' then -1 else 1
        where = if args.where then args.where else args
        where = convertWhere where
        console.log where
        collection.find where, options
        .sort sort
        .toArray myCb        
    )(ndx.user)
  count: (table, whereObj, cb) ->
    whereObj = convertWhere whereObj
    collection = database.collection table
    collection.count whereObj, (err, count) ->
      cb? count
  update:  (table, obj, whereObj, cb, isServer) ->
    whereObj = convertWhere whereObj
    cleanObj obj
    ((user) ->
      asyncCallback (if isServer then 'serverPreUpdate' else 'preUpdate'),
        id: obj._id
        table: table
        obj: obj
        where: whereObj
        user: user
      , (result) ->
        if not result
          return cb? []
        ndx.user = user
        collection = database.collection table
        delete obj._id
        collection.updateOne whereObj,
          $set: obj
        , (err, result) ->
          ndx.user = user
          asyncCallback (if isServer then 'serverUpdate' else 'update'),
            id: obj._id
            table: table
            obj: obj
            user: user
            isServer: isServer
          cb?()
    )(ndx.user)
  insert: (table, obj, cb, isServer) ->
    cleanObj obj
    ((user) ->
      ndx.user = user
      asyncCallback (if isServer then 'serverPreInsert' else 'preInsert'),
        table: table
        obj: obj
        user: user
      , (result) ->
        if not result
          return cb? []
        ndx.user = user
        collection = database.collection table
        if Object.prototype.toString.call(obj) is '[object Array]'
          collection.insertMany obj, (err, r) ->
            ndx.user = user
            for o in obj
              asyncCallback (if isServer then 'serverInsert' else 'insert'),
                id: o._id
                table: table
                obj: o
                user: user
                isServer: isServer
            cb? []
        else
          collection.insertOne obj, (err, r) ->
            ndx.user = user
            asyncCallback (if isServer then 'serverInsert' else 'insert'),
              id: obj._id
              table: table
              obj: obj
              user: user
              isServer: isServer
            cb? []
    )(ndx.user)
  upsert: (table, obj, whereObj, cb, isServer) ->
    if JSON.stringify(whereObj) isnt '{}'
      @update table, obj, whereObj, cb, isServer
    else
      @insert table, obj, cb, isServer
  delete: (table, whereObj, cb, isServer) ->
    whereObj = convertWhere whereObj
    ((user) ->
      asyncCallback (if isServer then 'serverPreDelete' else 'preDelete'),
        table: table
        where: whereObj
        user: user
      , (result) ->
        if not result
          cb? []
        ndx.user = user
        collection = database.collection table
        collection.deleteMany whereObj, null, ->
          asyncCallback (if isServer then 'serverDelete' else 'delete'), 
            table: table
            user: ndx.user
            isServer: isServer
          cb?()
    )(ndx.user) 
  maintenanceOn: ->
    maintenanceMode = true
  maintenanceOff: ->
    maintenanceMode = false
  version: ->
    version
  maintenance: ->
    maintenanceMode
  setNdx: (_ndx) ->
    ndx = _ndx
    @
  makeSlug: (table, template, data, cb) ->
    slug = s(ndx.fillTemplate(template, data)).prune(30, '').slugify().value()
    testSlug = slug
    outSlug = null
    async.whilst ->
      outSlug is null
    , (callback) =>
      @select table,
        slug: testSlug
      , (results) ->
        if results and results.length
          testSlug = slug + '-' + Math.floor(Math.random() * 9999)
        else
          outSlug = testSlug
        callback null, outSlug
    , (err, slug) ->
      data.slug = slug
      cb? true
  fieldFromTemplate: (template, data, fieldName) ->
    data[fieldName] = ndx.fillTemplate template, data