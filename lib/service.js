var HttpDuplex = require('http-duplex');
var inherits = require('inherits');
var es = require('event-stream');
var spawn = require('child_process').spawn;
var pack = require('./pack');

module.exports = function (opts, req, res) {
    var service = new Service(opts, req, res);
    
    Object.keys(opts).forEach(function (key) {
        service[key] = opts[key];
    });
    return service;
};

var headerRE = {
    'receive-pack' : '([0-9a-fA-F]+) ([0-9a-fA-F]+) refs\/(heads|tags)\/(.*?)( |00|\u0000)',
    'upload-pack' : '^\\S+ ([0-9a-fA-F]+)'
};

function Service (opts, req, res) {
    var self = this;
    HttpDuplex.call(self, req, res);
    
    self.status = 'pending';
    self.repo = opts.repo;
    self.service = opts.service;
    self.cwd = opts.cwd;
    
    var piped = false;
    self.on('pipe', function () {
        piped = true;
    });

    var buffered = [];
    var data = '';
    self.on('data', bufferOnData);
    function bufferOnData (buf) {
        buffered.push(buf);
    }

    self.on('data', function ondata (buf) {
        data += buf;
        
        var ops = data.match(new RegExp(headerRE[self.service], 'gi'));
        if (!ops) return;
        data = undefined;
       
        ops.forEach(function(op) {
            var m = op.match(new RegExp(headerRE[self.service]));
            if (self.service === 'receive-pack') {
                self.last = m[1];
                self.commit = m[2];

                var type;
                if (m[3] == 'heads') {
                    type = 'branch';
                    self.evName = 'push';
                } else {
                    type = 'version';
                    self.evName = 'tag';
                }

                var headers = {
                    last: self.last,
                    commit : self.commit
                };
                headers[type] = self[type] = m[4];
                self.emit('header', headers);
            }
            else if (self.service === 'upload-pack') {
                self.commit = m[1];
                self.evName = 'fetch';
                self.emit('header', { commit : self.commit });
            }
        });
    });
    
    self.once('accept', function (keepOpen) {
        process.nextTick(function () {
            var ps = spawn('git-' + opts.service, [
                '--stateless-rpc',
                opts.cwd
            ]);
            self.emit('service', ps);

            if (!keepOpen) {
                ps.stdout.pipe(self, { end: !piped });
            } else {
                ps.stdout.on("data", function(data) {
                    if (data.length !== 4 && String(data) !== '0000') {
                        self.write(data);
                    }
                });
            }

            self.removeListener('data', bufferOnData);
            buffered.forEach(function (buf) {
                ps.stdin.write(buf);
            });
            buffered = undefined;
            
            self.pipe(ps.stdin);
            ps.on('exit', self.emit.bind(self, 'exit'));
        });
    });
}

inherits(Service, HttpDuplex);

Service.prototype.accept = function (keepOpen) {
    if (this.status !== 'pending') return;
    
    this.status = 'accepted';
    this.emit('accept', keepOpen);
};

Service.prototype.done = function () {
    this.write('0000');
    this.end();
};

Service.prototype.message = function (msg) {
    this.write(pack("\u0002" + msg));
};

Service.prototype.reject = function (code, msg) {
    if (this.status !== 'pending') return;
    
    if (msg === undefined && typeof code === 'string') {
        msg = code;
        code = 500;
    }
    this.statusCode = code || 500;
    if (msg) this.write(msg);
    
    this.status = 'rejected';
    this.emit('reject');
};
