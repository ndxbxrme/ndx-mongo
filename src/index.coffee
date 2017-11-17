'use strict'

MongoClient = require 'mongodb'
.MongoClient
ObjectId = require 'mongodb'
.ObjectId
async = require 'async'
minimatch = require 'minimatch'
crypto = require 'crypto'
cryptojs = require 'crypto-js'
algorithm = 'aes-256-ctr'
objtrans = require 'objtrans'
settings = require './settings'
s = require('underscore.string')
version = require('../package.json').version
database = null
ndx = {}
maintenanceMode = false
useEncryption = false
encryptIgnore = ['**._id']
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
  selectTransform: []
  serverSelectTransform: []
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
encryptString = (str) ->
  if str
    return cryptojs.AES.encrypt(str, (settings.ENCRYPTION_KEY or settings.SESSION_SECRET)).toString()
  return null
decryptString = (str) ->
  if str
    return cryptojs.AES.decrypt(str, (settings.ENCRYPTION_KEY or settings.SESSION_SECRET)).toString(cryptojs.enc.Utf8)
  return ''
encryptObj = (obj, path) ->
  myobj = {}
  for ignore in encryptIgnore
    if minimatch path, ignore
      return obj
  type = Object.prototype.toString.call obj
  if type is '[object Object]'
    for key of obj
      myobj[key] = encryptObj obj[key], "#{path}.#{key}"
  else
    return encryptString JSON.stringify obj
  myobj
decryptObj = (obj, path) ->
  for ignore in encryptIgnore
    if minimatch path, ignore
      return obj
  type = Object.prototype.toString.call obj
  if type is '[object Object]'
    for key of obj
      obj[key] = decryptObj obj[key], "#{path}.#{key}"
  else
    if not obj
      return obj
    return JSON.parse decryptString obj
  obj
encryptWhere = (obj, path) ->
  type = Object.prototype.toString.call obj
  for ignore in encryptIgnore
    if minimatch path, ignore
      return obj
  if type is '[object Object]'
    for key of obj
      mypath = path
      if key.indexOf('$') isnt 0
        mypath = "#{path}.#{key}"
      obj[key] = encryptWhere obj[key], mypath
  else
    return encryptString JSON.stringify obj
  obj
cleanObj = (obj) ->
  for key of obj
    if key.indexOf('$') is 0 or key is '#'
      delete obj[key]
  return
convertWhere = (where) ->
  walk = (base, current, route) ->
    if current and current.hasOwnProperty('$like')
      current.$regex = ".*#{current.$like or ''}.*"
      current.$options = 'i'
      delete current.$like
    for key of current
      obj = current[key]
      type = Object.prototype.toString.call obj
      if type is '[object Object]'
        if key.indexOf('$') is 0
          walk obj, obj, ''
        else
          newroute = route
          if newroute
            newroute += '.'
          newroute += key
          walk current, obj, newroute
      else if type is '[object Array]'
        if obj.length and Object.prototype.toString.call(obj[0]) is '[object Object]'
          for item in obj
            item = walk item, item, ''
      else
        if key.indexOf('$') is 0
          base[route][key] = obj
        else if route
          newroute = route + '.' + key
          base[newroute] = obj
          delete base[newroute.split(/\./g)[0]]
        else
          if key is '_id' or newroute is '_id'
            obj = new ObjectId obj
          base[key] = obj
  walk where, where, ''
  delete where['#']
  where
module.exports =
  config: (config) ->
    for key of config
      keyU = s(key).underscored().value().toUpperCase()
      settings[keyU] = config[key] or config[keyU] or settings[keyU]
    if settings.ENCRYPT_IGNORE
      encryptIgnore = settings.ENCRYPT_IGNORE
    if settings.ENCRYPT_MONGO
      useEncryption = true
    settings.ENCRYPTION_KEY = settings.ENCRYPTION_KEY or process.env.ENCRYPTION_KEY
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
        pre: true
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
            post: true
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
            if useEncryption
              for obj in output
                obj = decryptObj obj, table
            asyncCallback (if isServer then 'serverSelectTransform' else 'selectTransform'),
              transform: true
              table: table
              objs: output
              isServer: isServer
              user: user
            , ->
              ndx.user = user
              cb? output, total
        collection = database.collection table
        options = {}
        sort = {}
        if args.sort
          sort[args.sort] = if args.sortDir is 'DESC' then -1 else 1
        where = if args.where then args.where else args
        where = convertWhere where
        #if useEncryption
        #  where = encryptWhere where, table
        #console.log table
        #console.log where
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
    if useEncryption
      where = encryptWhere where, table
    cleanObj obj 
    ((user) ->
      asyncCallback (if isServer then 'serverPreUpdate' else 'preUpdate'),
        pre: true
        id: obj._id or whereObj._id
        table: table
        obj: obj
        where: whereObj
        user: user
      , (result) ->
        if not result
          return cb? []
        ndx.user = user
        collection = database.collection table
        id = obj._id or whereObj._id
        delete obj._id
        collection.updateOne whereObj,
          $set: if useEncryption then encryptObj(obj, table) else obj
        , (err, result) ->
          ndx.user = user
          asyncCallback (if isServer then 'serverUpdate' else 'update'),
            post: true
            id: id
            table: table
            obj: obj
            user: user
            isServer: isServer
          cb? err, 
            op: 'update'
            id: result.insertedId
    )(ndx.user)
  insert: (table, obj, cb, isServer) ->
    cleanObj obj
    ((user) ->
      ndx.user = user
      asyncCallback (if isServer then 'serverPreInsert' else 'preInsert'),
        pre: true
        table: table
        obj: obj
        user: user
      , (result) ->
        if not result
          return cb? []
        ndx.user = user
        collection = database.collection table
        if Object.prototype.toString.call(obj) is '[object Array]'
          async.each obj, (o, callback) ->
            collection.insertOne (if useEncryption then encryptObj(o, table) else o)
            , (err, r) ->
              ndx.user = user
              o._id = r.insertedId
              asyncCallback (if isServer then 'serverInsert' else 'insert'),
                post: true
                id: o._id
                table: table
                obj: o
                user: user
                isServer: isServer
              cb? err, 
                op: 'insert'
                id: r.insertedId
              callback()
        else
          collection.insertOne (if useEncryption then encryptObj(obj, table) else obj)
          , (err, r) ->
            ndx.user = user
            obj._id = r.insertedId
            asyncCallback (if isServer then 'serverInsert' else 'insert'),
              post: true
              id: obj._id
              table: table
              obj: obj
              user: user
              isServer: isServer
            cb? err, 
              op: 'insert'
              id: r.insertedId
    )(ndx.user)
  upsert: (table, obj, whereObj, cb, isServer) ->
    if JSON.stringify(whereObj) isnt '{}'
      @update table, obj, whereObj, cb, isServer
    else
      @insert table, obj, cb, isServer
  delete: (table, whereObj, cb, isServer) ->
    whereObj = convertWhere whereObj
    if useEncryption
      where = encryptWhere where, table
    ((user) ->
      asyncCallback (if isServer then 'serverPreDelete' else 'preDelete'),
        pre: true
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
            post: true
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
    if data.slug and data.slug.indexOf(slug) is 0
      return cb true
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
  decryptObj: decryptObj