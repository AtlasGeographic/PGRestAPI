//Express, Common and settings should be used by all sub-modules
var express = require('express'),
  common = require("../../common"),
  settings = require('../../settings');

//These next requires are specific to this module only
var path = require('path'),
  flow = require('flow'),
  zlib = require('zlib')

var tilelive = require('tilelive');
var MMLBuilder = require("../tiles/cartotomml/mml_builder");
var fs = require("fs");
if (tilelive) {
  tilelive.protocols['mbtiles:'] = require('mbtiles');
}

var _vectorTileRoutes = []; //Keep a list of vector tile routes
var _imageTileRoutes = []; //Keep a list of image tile routes

var mbTileFiles = []; //list of mbtileFiles
var PNGmbTileFiles = [];


exports.app = function (passport) {
  var app = express();

  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');

  //Show List of each .mbtiles file
  app.all('/services/vector-tiles', function (req, res) {

    var args = {};
    args.view = "vector_tile_list";
    args.breadcrumbs = [
      {
        link: "/services",
        name: "Home"
      },
      {
        link: "",
        name: "Vector Tiles List"
      }
    ];
    args.url = req.url;
    args.opslist = [];

    if (mbTileFiles && mbTileFiles.length > 0) {
      mbTileFiles.forEach(function (item) {
        args.opslist.push({
          name: item.id,
          link: "dataset?name=" + item.id,
          center: item.center,
          fullURL: path.join(req.url, "dataset?name=" + item.id)
        });
      });
    }

    //Render HTML page with results at bottom
    common.respond(req, res, args);
  });

  //Show example of how to use this dataset
  app.all('/services/vector-tiles/dataset', flow.define(function (req, res) {
    this.args = {};
    this.req = req;
    this.res = res;

    //Grab POST or QueryString args depending on type
    if (req.method.toLowerCase() == "post") {
      //If a post, then arguments will be members of the this.req.body property
      this.args = req.body;
    } else if (req.method.toLowerCase() == "get") {
      //If request is a get, then args will be members of the this.req.query property
      this.args = req.query;
    }

    if (JSON.stringify(this.args) != '{}') {
      //User passed in some args.
      this.args.view = "tile_vector_dynamic_map";
      this.args.breadcrumbs = [
        {
          link: "/services",
          name: "Home"
        },
        {
          link: "/services/vector-tiles",
          name: "Vector Tiles List"
        },
        {
          link: "",
          name: "Vector Tile dataset"
        }
      ];
      this.args.url = req.url;
      this.args.path = this.req.path;
      this.args.host = this.req.headers.host;

      if (this.args.name) {
        //The name of the mbtiles dataset
        this.args.description = "";
        this.args.requestSample = ((req.secure ? "https:" : "http:") + "//" + this.args.host + this.args.path + "/{z}/{x}/{y}.pbf").replace("/dataset/", "/" + this.args.name.split(".")[0] + "/");

        //Write out the details for this map service
        this.args.featureCollection = [];
        this.args.featureCollection.push({
          name : "Map Service Endpoint",
          link: ((req.secure ? "https:" : "http:") + "//" + this.args.host + this.args.path).replace("/dataset", "/" + this.args.name.split(".")[0])
        });

        var self = this;

        //look up tileJSON info
        if (mbTileFiles && mbTileFiles.length > 0) {
          mbTileFiles.forEach(function (item) {
            if(item.id == self.args.name){
              self.args.featureCollection[0].center = { lat: item.center[1], lng: item.center[0], zoom: item.center[2]};
            }
          });
        }

        //load leaflet
        this.args.scripts = [settings.leaflet.js];
        //Load external scripts for map preview
        this.args.css = [settings.leaflet.css];

        common.respond(this.req, this.res, this.args);
      } else {

        this.args.errorMessage = "Must include parameter name";
        this.args.url = req.url;
        common.respond(this.req, this.res, this.args);
      }

    } else {
      //Page initial load.  No results
      this.args.view = "tile_vector_dynamic_map";
      this.args.breadcrumbs = [
        {
          link: "/services",
          name: "Home"
        },
        {
          link: "/services/vector-tiles",
          name: "Vector Tiles List"
        },
        {
          link: "",
          name: "Vector Tile dataset"
        }
      ];
      this.args.url = req.url;
      common.respond(this.req, this.res, this.args);
    }

  }));

  console.log("About to load PBF .mbtiles");
  loadPBFMBTilesRoutes(app);  

  //console.log("About to load PNG .mbtiles");
  loadPNGMBTilesRoutes(app);

  return app;
};

exports.getVectorTileRoutes = function () {
  return _vectorTileRoutes;
}

exports.getImageTileRoutes = function () {
  return _imageTileRoutes;
}

function loadPNGMBTilesRoutes(app){
  var PNGmbtilesLocation = path.join(__dirname, "../../data/png_mbtiles");

  tilelive.all(PNGmbtilesLocation, function(err, list){
    PNGmbTileFiles = list;
    console.log("fetched tilelive list of PNGs");

    //Create endpoint for mbtiles server, 1 for each source
    //PNGmbTileFiles.forEach(function (file) { 
    asyncEach(PNGmbTileFiles, function(file, idx){    
     debugger;
     console.log("iterating on PNGMBTiles List - " + file.basename);

      var PNGroute = ""; //store the route name

      var mbtilespath = 'mbtiles://' + path.join(PNGmbtilesLocation, file.basename);

      
     
      tilelive.load(mbtilespath, function (err, source) {
	debugger;
	if (err) {
          console.log("Error creating service for " + file.basename);
	  return;
	}
	
        console.log("Tilelive Loaded " + file.basename);
        var name = file.basename.split('.')[0];
        PNGroute = '/services/tiles/' + name  + '/:z/:x/:y.png';

        app.get(PNGroute, function (req, res) {
          source.getTile(req.param('z'), req.param('x'), req.param('y'), function (err, tile, headers) {
            // `err` is an error object when generation failed, otherwise null.
            // `tile` contains the compressed image file as a Buffer
            // `headers` is a hash with HTTP headers for the image.
            res.setHeader('content-type', 'image/png');
            if (!err) {
              res.send(tile);
            } else {
              res.send("problem.");
            }
          });
        });

        console.log("Created PNG .mbtiles service: " + PNGroute);
        _imageTileRoutes.push({ name: name, route: PNGroute, type: ".png .mbtiles" });
      });

}, 1000);




   // });

  });
}

function asyncEach(array, fn, delay){
  var i = 0;
  setTimeout(function iter(){
    if(i===array.length){
      return;
    }
    fn.call(array, array[i], i++);
    setTimeout(iter, delay);
  }, 0);
}

function loadPBFMBTilesRoutes(app) {
  var mbtilesLocation = path.join(__dirname, "../../data/pbf_mbtiles");

  //Load mbtiles from mbtiles folder.
  tilelive.all(mbtilesLocation, function (err, list) {
    mbTileFiles = list;

    //Create endpoint for mbtiles server, 1 for each source
    mbTileFiles.forEach(function (file) {

      var PBFroute = ""; //store the route name

      var mbtilespath = 'mbtiles://' + path.join(mbtilesLocation, file.basename);

      tilelive.load(mbtilespath, function (err, source) {
        if (err)
          throw err;

        var name = file.basename.split('.')[0];

        PBFroute = '/services/vector-tiles/' + name + '/:z/:x/:y.pbf';

        app.get(PBFroute, function (req, res) {

          source.getTile(req.param('z'), req.param('x'), req.param('y'), function (err, tile, headers) {
            // `err` is an error object when generation failed, otherwise null.
            // `tile` contains the compressed image file as a Buffer
            // `headers` is a hash with HTTP headers for the image.
            res.setHeader('content-type', 'application/x-protobuf');
            if (!err) {
              if(res.req.headers["accept-encoding"] && res.req.headers["accept-encoding"].indexOf("deflate") > -1){
                res.setHeader('content-encoding', 'deflate');
                res.send(tile);
                return;
              }
              else{
                //no deflate.  Actually inflate the thing and send it (for phantomjs that doesn't request deflate in request headers.
                zlib.inflate(tile, function(err, buffer){
                  res.send(buffer);
                  return;
                });
              }

            } else {
              res.send(new Buffer(''));
            }
          });
        });

        console.log("Created PBF .mbtiles service: " + PBFroute);
        _vectorTileRoutes.push({ name: name, route: PBFroute, type: ".pbf .mbtiles" });
      });
    });
  });
}

//Experiments.
function loadTM2ZSources(){

  var tm2zLocation = __dirname + "/tm2z";
  var tm2zFiles = [];

  //Load mbtiles from mbtiles folder.
  require("fs").readdirSync(tm2zLocation).forEach(function (file) {
    var ext = path.extname(file);
    if (ext == ".tm2z") {
      tm2zFiles.push(file);
    }
  });

  tm2zFiles.forEach(function (filename) {

    var tm2zpath = 'tm2z://' + path.join(tm2zLocation, filename);

    tilelive.load(tm2zpath, function (err, source) {
      if (err)
        throw err;

      //Handle PNG requests.
      var PNGroute = '/services/vector-tiles/' + filename.split('.')[0] + '/:z/:x/:y.png';

      app.get(PNGroute, function (req, res) {
        source.getTile(req.param('z'), req.param('x'), req.param('y'), function (err, tile, headers) {
          // `err` is an error object when generation failed, otherwise null.
          // `tile` contains the compressed image file as a Buffer
          // `headers` is a hash with HTTP headers for the image.
          if (!err) {

            res.setHeader('content-type', 'image/png');
            res.send(tile);
          } else {
            res.send('Tile rendering error: ' + err + '\n');
          }
        });
      });
      console.log("Created PNG .mbtiles service: " + PNGroute);
    });
  });


}

function getDefaultStyle(cb){

  //Set the path to the style file
  var fullpath =  path.join(__dirname, "default.mss");

  //Save the flow
  var flo = this;

  //See if there is a <name>.xml file for this table.
  fs.stat(fullpath, function (err, stat) {
    if (err) {
      //No file.  Use defaults.
      //fullpath = path.join(_stylepath, _defaultMSS);
    }

    //Read the file and pass the contents to the next function
    fs.readFile(fullpath, 'utf8', function(err, styleString){
      //CartoCSS Converter
      var optional_args = {};
      optional_args.cachedir = '/tmp/millstone';

      //Convert mss to XML
      var MMLConverter = new MMLBuilder({ table: "default"}, optional_args, function(err, payload){});
      MMLConverter.render(styleString, function(err, mmlStylesheet){

        MMLConverter.stripLayer(mmlStylesheet, function(err, converted){
          cb(converted);
        });

      });
    });

  });
}
