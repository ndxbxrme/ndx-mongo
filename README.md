# ndx-mongo  

mongo database connector for ndx-framework apps  
-----------------------------------------------

## Usage  
```bash
npm install --save ndx-mongo
```
#### `src/server/app.coffee`
```coffeescript
require 'ndx-server
  dbEngine: require 'ndx-mongo'
  mongoUrl: 'mongodb://192.168.99.100:27017/test'
  tables: ['users', 'table1', 'table2']
.start()
```

## Environment variables
mongoUrl can be set with the environment variable `MONGO_URL`  

## Callbacks

```coffeescript
ndx.database.on 'callbackName', (args, cb) ->
  #do something with args
  cb true #or false if you want to cancel the operation
```

### `ready`
  The database is ready to use

### `preInsert`
* `args.table`
  The database table being operated on
* `args.obj`
  The object being inserted into the database
* `args.user`
  The user carrying out the operation
  
`cb(false)` to cancel the insert
  
### `insert`
* `args.id`
  The inserted object's id
* `args.table`
  The database table being operated on
* `args.obj`
  The object that was inserted into the database
* `args.user`
  The user carrying out the operation
  
### `preUpdate`
* `args.id`
  The id of the object being updated
* `args.table`
  The database table being operated on
* `args.where`
  The database query
* `args.obj`
  The data to update
* `args.oldObj`
  The value of the object preUpdate
* `args.changes`
  The changes to be applied
* `args.user`
  The user carrying out the operation
  
`cb(false)` to cancel the update
  
### `update`
* `args.id`
  The id of the object that was updated
* `args.table`
  The database table that was operated on
* `args.obj`
  The data that was updated
* `args.oldObj`
  The value of the object pre update
* `args.newObj`
  The value of the object post update
* `args.changes`
  The changes that were applied
* `args.user`
  The user carrying out the operation
  
### `preSelect`
* `args.table`
  The database table being operated on
* `args.args`
  The arguments that were passed to the select function
* `args.user`
  The user carrying out the operation
  
### `select`
* `args.table`
  The database table being operated on
* `args.objs`
  The objects that were selected from the database
* `args.user`
  The user carrying out the operation
  
### `preDelete`
* `args.table`
  The database table being operated on
* `args.where`
  The database query
* `args.user`
  The user carrying out the operation
  
### `delete`
* `args.table`
  The database table being operated on
* `args.user`
  The user carrying out the operation
  
callbacks can be used to modify data flowing to and from the database.  
see [ndx-permissions](https://github.com/ndxbxrme/ndx-permissions) and [ndx-profiler](https://github.com/ndxbxrme/ndx-profiler) for examles  

#### `db.off(string callbackName, function callback) -> db`

Unregister a callback

#### `db.select(string table, object whereObj, function callback)`

Select data  

#### `db.insert(string table, object insertObj, function callback)`

Insert data

#### `db.update(string table, object updateObj, object whereObj, function callback)`

Update data

#### `db.upsert(string table, object upsertObj, object whereObj, function callback)`

Upsert data

#### `db.delete(string table, object whereObj, function callback)`

Delete data  

#### `db.exec(string sql, array props, bool notCritical) -> data`