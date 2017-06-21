'use strict'

MongoClient = require 'mongodb'
.MongoClient
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
        output[route] =
          $regex: ".*#{obj[key] or ''}.*"
          $options: 'i'
      else if key.indexOf('$') is 0
        output[key] = {}
        walk obj[key], route, output[key]
      else if Object.prototype.toString.call(obj[key]) is '[object Object]'
        walk obj[key], route + ".#{key}", output
      else
        output[(route + ".#{key}").replace(/^\./, '')] = obj[key]
  walk obj, '', output
  output
module.exports =
  config: (config) ->
    for key of config
      keyU = s(key).underscored().value().toUpperCase()
      settings[keyU] = config[key] or config[keyU] or settings[keyU]
    @
  start: ->
    MongoClient.connect settings.MONGO_URL, (err, db) ->
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
          if err
            return cb? [], 0
          asyncCallback (if isServer then 'serverSelect' else 'select'), 
            table: table
            objs: output
            isServer: isServer
            user: user
          , ->
            total = output.length
            if args.page or args.pageSize
              args.page = args.page or 1
              args.pageSize = args.pageSize or 10
              output = output.splice (args.page - 1) * args.pageSize, args.pageSize
            cb? output, total
        collection = database.collection table
        options = {}
        where = if args.where then args.where else args
        where = convertWhere where
        collection.find where, options
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
        id: getId obj
        table: table
        obj: obj
        where: whereObj
        user: user
      , (result) ->
        if not result
          return cb? []
        ndx.user = user
        collection = database.collection table
        collection.updateOne whereObj,
          $set: obj
        , (err, result) ->
          cb?()
    )(ndx.user)
  insert: (table, obj, cb, isServer) ->
    cleanObj obj
    ((user) ->
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
            cb? []
        else
          collection.insertOne obj, (err, r) ->
            cb? []
    )(ndx.user)
  upsert: (table, obj, whereObj, cb, isServer) ->
    whereObj = convertWhere whereObj
    collection = database.collection table
    collection.findOne whereObj, (err, result) =>
      if not err and result
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
    @select table,
      slug: slug
    , (results) ->
      if results.length
        slug = slug + Math.floor(Math.random() * 9999)
      data.slug = slug
      cb? true