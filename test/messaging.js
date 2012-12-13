var test = require('tap').test;
var pushover = require('../');

var fs = require('fs');
var path = require('path');
var exists = fs.exists || path.exists;

var spawn = require('child_process').spawn;
var http = require('http');

var seq = require('seq');

test('create, push to, and clone a repo with messages', function (t) {
    t.plan(5);
    
    var repoDir = '/tmp/' + Math.floor(Math.random() * (1<<30)).toString(16);
    var srcDir = '/tmp/' + Math.floor(Math.random() * (1<<30)).toString(16);
    var dstDir = '/tmp/' + Math.floor(Math.random() * (1<<30)).toString(16);
    
    fs.mkdirSync(repoDir, 0700);
    fs.mkdirSync(srcDir, 0700);
    fs.mkdirSync(dstDir, 0700);
    
    var repos = pushover(repoDir);
    var port = Math.floor(Math.random() * ((1<<16) - 1e4)) + 1e4;
    var server = http.createServer(function (req, res) {
        repos.handle(req, res);
    });
    server.listen(port);
    
    process.chdir(srcDir);
    seq()
        .seq(function () {
            var ps = spawn('git', [ 'init' ]);
            ps.stderr.pipe(process.stderr, { end : false });
            ps.on('exit', this.ok);
        })
        .seq(function () {
            fs.writeFile(srcDir + '/a.txt', 'abcd', this);
        })
        .seq(function () {
            spawn('git', [ 'add', 'a.txt' ]).on('exit', this.ok)
        })
        .seq(function () {
            spawn('git', [ 'commit', '-am', 'a!!' ]).on('exit', this.ok)
        })
        .seq_(function (next) {
            var ps = spawn('git', [
                'push', 'http://localhost:' + port + '/doom', 'master'
            ]);
            ps.stderr.pipe(process.stderr, { end : false });

            var expected = ["test1","test2","test3"];
            var unexpected = ["test4"];

            var buf = "";
            ps.stderr.on('data', function(data){
                buf += String(data);
            });

            ps.on('exit', function(){
                expected.forEach(function(msg){
                    var idx = buf.indexOf(msg);
                    t.ok(idx > -1, msg + ' expected message received');
                });
                unexpected.forEach(function(msg){
                    var idx = buf.indexOf(msg);
                    t.ok(idx == -1, 'unexpected message received');
                });
                next();
            });
        })
        .seq(function () {
            process.chdir(dstDir);
            spawn('git', [ 'clone', 'http://localhost:' + port + '/doom' ])
                .on('exit', this.ok)
        })
        .seq_(function (next) {
            path.exists(dstDir + '/doom/a.txt', function (ex) {
                t.ok(ex, 'a.txt exists');
                next();
            })
        })
        .seq(function () {
            server.close();
            t.end();
        })
        .catch(t.fail)
    ;
    
    repos.on('push', function (push) {
        t.equal(push.repo, 'doom');
        push.accept(true);
        push.message('test1\r\n');
        push.message('test2\r\n');
        setTimeout(function(){
            push.message('test3\r\n');
            push.done();
            push.message('test4\r\n');
        }, 500);
    });
});
