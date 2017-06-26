'use strict'
var pull = require('pull-stream')
var query = require('./query')
var select = require('./select')
var mfr = require('map-filter-reduce')
var keys = require('map-filter-reduce/keys')
var explain = require('explain-error')
var u = require('./util')

var FlumeViewLevel = require('flumeview-level')

var isArray = Array.isArray

function fullScan(log, opts) {
  return log.stream({
      values: true, seqs: false, live: opts.live, limit: opts.limit, reverse: opts.reverse
    })
}

//sorted index.

//split this into TWO modules. flumeview-links and flumeview-query
module.exports = function (indexes, version) {

  function create(log, name) {

    if (!indexes.length) {
      return {
        since: log.since,
        get: log.get,
        methods: { get: 'async', read: 'source'},
        read: function (opts) {
          var filter = isArray(opts.query) ? mfr(opts.query) : pull.through()
          return pull(fullScan(log, opts), filter)
        },
        createSink: function (cb) {return pull.onEnd(cb) }
      }
    }
 
    return FlumeViewLevel(version || 1, function (data, seq) {
      var A = []
      indexes.forEach(function (index) {
        var a = [index.key]
        for(var i = 0; i < index.value.length; i++) {
          var key = index.value[i]
          if(!u.has(key, data)) return []
          a.push(u.get(key, data))
        }
        a.push(seq); A.push(a)
      })
      return A
    })(log, name)
  }

  return function (log, name) {

    var index = create(log, name)
    var read = index.read

    index.read = function (opts) {

      opts = opts || {}
      var _opts = {}
      var q, k

      if(isArray(opts.query)) {
        q = opts.query[0].$filter || {}
      }
      else if(opts.query) {
        q = opts.query
      }
      else
        q = {}

      var index = select(indexes, q)
      var filter = isArray(opts.query) ? mfr(opts.query) : pull.through()

      if(!index)
        return pull(fullScan(log, opts),  filter)

      var _opts = query(index, q)

      _opts.values = false
      _opts.keys = true

      _opts.reverse = !!opts.reverse
      _opts.live = opts.live
      _opts.old = opts.old
      _opts.sync = opts.sync
      _opts.limit = opts.limit

      return pull(
        read(_opts),
        pull.map(function (data) {
          if(data.sync) return data
          else return data.value
        }),
        filter
      )

    }

    return index
  }
}
