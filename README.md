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