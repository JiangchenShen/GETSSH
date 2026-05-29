const fs = require('fs');
const sysprobe = require('./rust-core/getssh-sysprobe/index.node');
console.log(sysprobe.getSystemStats());
