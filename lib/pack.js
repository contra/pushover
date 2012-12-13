function pack (s) {
    var n = (4 + s.length).toString(16);
    return Array(4 - n.length + 1).join('0') + n + s;
}

module.exports = pack;
