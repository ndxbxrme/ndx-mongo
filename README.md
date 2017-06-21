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
  tables: ['users', 'table1', 'table2']
.start()
```