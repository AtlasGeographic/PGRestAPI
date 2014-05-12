﻿//////////Nodetiles

//Common and settings should be used by all sub-modules
var express = require('express'), common = require("../../common"), settings = require('../../settings');

//Module-specific requires:
var mapnik = require('mapnik'),
mercator = require('../../utils/sphericalmercator.js'), // 3857
geographic = require('../../utils/geographic.js'), //4326
mappool = require('../../utils/pool.js'),
parseXYZ = require('../../utils/tile.js').parseXYZ,
path = require('path'),
fs = require("fs"),
flow = require('flow'),
carto = require('carto'),
zlib = require("zlib");

//Caching
var CCacher = require("../../lib/ChubbsCache");
var cacher = new CCacher();


var TMS_SCHEME = false;
var _styleExtension = '.xml';

var PGTileStats = {
    SingleTiles: { times: [] },
    MultiTiles: { times: [] },
    VectorTiles: { times: [] },
    MemoryTiles: { times: []}
};

var ShapeTileStats = {
    SingleTiles: { times: [] },
    MultiTiles: { times: [] },
    VectorTiles: { times: [] },
    MemoryTiles: { times: []}
};

var RasterTileStats = {
    SingleTiles: { times: [] },
    MultiTiles: { times: [] },
    VectorTiles: { times: [] },
    MemoryTiles: { times: []}
};


//Store a list of Shapefiles stored in the Mapnik/data/shapefiles folder.
var shapefiles = []; //a list of shapefiles that will be dynamically read
var memoryShapefileList = []; //a list of shapefile names to be loaded into memory
var memoryShapefiles = {}; //Store the memory datasources here
var rasters = []; //a list of rasters that will be dynamically read

// register shapefile plugin
if (mapnik.register_default_input_plugins)
    mapnik.register_default_input_plugins();

//Use pooling to handle concurrent map requests
//var maps = mappool.create_pool(10);
//TODO: Determine the best value for this

var tileSettings = { mapnik_datasource: {}, tileSize: { height: 256, width: 256}, routeProperties: { name: "", source: "", geom_field: "", srid: "", cartoFile: "" }};

exports.app = function (passport) {
    var app = express();

    var shpLocation = path.join(__dirname, "/data/shapefiles");
    var memoryShpLocation = path.join(__dirname, "/data/inmemory-shapefiles");
    var rasterLocation = path.join(__dirname, "/data/rasters");

    //Find Shapefiles
    shapefiles = getShapeFilePaths(shpLocation);

    //Find shapefiles to be loaded into memory
    memoryShapefileList = getMemoryShapeFilePaths(memoryShpLocation);

    //Find Rasters
    rasters = getRasterPaths(rasterLocation);

    //Return json of found shapefiles - setting this to /services/shapefiles causes all requests to /services/shapefiles/name/dynamicMap to simply revert to this.
    //Probably has to do with the fact that endpoints below use this.app.use instead of this.app.all (which doesn't work for some reason')
    app.get('/shapefiles', function (req, res) {

        var resultSet = [];

        var args = req.query;
        if (args && args.limit) {
            resultSet = shapefiles.splice(0, args.limit);
        }
        else {
            resultSet = shapefiles;
        }

        res.json({
            shapefiles: resultSet
        });
    });


    //TODO:  Treat the in-memory shapefiles the same as non-memory shapefiles.  Use the same endpoints, but use a flag of some sort to determine which are in and out of memory.
    app.get('/memshapefiles', function (req, res) {

        var resultSet = [];

        var args = req.query;
        if (args && args.limit) {
            resultSet = memoryShapefiles.splice(0, args.limit);
        }
        else {
            resultSet = memoryShapefiles;
        }

        res.json({
            shapefiles: resultSet
        });
    });

    //Return json of found rasters - setting this to /services/rasters causes all requests to /services/rasters/name/dynamicMap to simply revert to this.
    //Probably has to do with the fact that endpoints below use this.app.use instead of this.app.all (which doesn't work for some reason')
    app.get('/rasters', function (req, res) {

        var resultSet = [];

        var args = req.query;
        if (args && args.limit) {
            resultSet = rasters.splice(0, args.limit);
        }
        else {
            resultSet = rasters;
        }

        res.json({
            rasters: resultSet
        });
    });


    // listen for events to track cache rate and errors
    cacher.on("hit", function(key) {
        console.log("Using Cached response for: " + key)
    });
    cacher.on("miss", function(key) {
        console.log("No cached response for: " + key + ".  Generating.")
    });
    cacher.on("error", function(key) {
        console.log("Error with cache. " + err)
    });

    var shpName = "";
    //Loop thru shapes and spin up new routes
    shapefiles.forEach(function (item) {
        shpName = item.split('.')[0];
        //createShapefileTileRenderer(app, shpName, shpLocation + "/" + item, 4326, null);
        //createShapefileSingleTileRenderer(app, shpName, shpLocation + "/" + item, 4326, null);

        tileSettings.mapnik_datasource = {
            type: 'shape',
            file: path.join(shpLocation, item)
        };
        tileSettings.routeProperties.name = shpName;
        tileSettings.routeProperties.srid = 4326;
        tileSettings.routeProperties.cartoFile = "";
        tileSettings.routeProperties.source = "shapefile";
        tileSettings.routeProperties.defaultStyle = "";//The name of the style inside of the xml file
        tileSettings.routeProperties.performanceObject = ShapeTileStats;
    });

    var memoryShpName = "";
    memoryShapefileList.forEach(function (item) {
        //Also (for performance testing puproses, create in-memory versions of the .shp datasources and spin up a new route for those)
        memoryShpName = item.split('.')[0];
        //memoryShapefiles[memoryShpName] = createInMemoryDatasource(memoryShpName, memoryShpLocation + "/" + item);
        //createMemoryShapefileSingleTileRenderer(app, memoryShpName, memoryShapefiles[memoryShpName], 4326, null);
        //createMemoryShapefileTileRenderer(app, memoryShpName, memoryShapefiles[memoryShpName], 4326, null);
    });

    var rasterName = "";
    //Loop thru rasters and spin up new routes
    rasters.forEach(function (item) {
        rasterName = item.split('.')[0];
        //createRasterTileRenderer(app, rasterName, rasterLocation + "/" + item, 4326, null);
    });


    //Load PG Tables
    //look thru all tables in PostGres with a geometry column, spin up dynamic map tile services for each one
    //common.vacuumAnalyzeAll();
    common.findSpatialTables(app, function (error, tables) {
        if (error) {
            console.log(error);
        } else {
            if (tables) {
                Object.keys(tables).forEach(function (key) {
                    var item = tables[key];

                    (function (item) {

                        var tileSettings ={ routeProperties: {} };

                        tileSettings.mapnik_datasource = {
                            'host': settings.pg.server,
                            'port': settings.pg.port,
                            'dbname': settings.pg.database,
                            'table': item.table,
                            'user': settings.pg.username,
                            'password': settings.pg.password,
                            'type': 'postgis',
                            'estimate_extent': 'true'
                        };
                        tileSettings.routeProperties.name = item.table;
                        tileSettings.routeProperties.srid = item.srid;
                        tileSettings.routeProperties.cartoFile = "";
                        tileSettings.routeProperties.source = "postgis";
                        tileSettings.routeProperties.geom_field = item.geometry_column;
                        tileSettings.routeProperties.defaultStyle = "";//The name of the style inside of the xml file

                        createMultiTileRoute(app, tileSettings, PGTileStats.MultiTiles);


                        createSingleTileRoute(app, tileSettings, PGTileStats.SingleTiles);


                        createVectorTileRoute(app, tileSettings, PGTileStats.VectorTiles);

                        //Spin up a route to serve dynamic tiles for this table
                        //createPGTileRenderer(app, item.table, item.geometry_column, item.srid, null);
                        //createPGVectorTileRenderer(app, item.table, item.geometry_column, item.srid, null);
                        //createPGTileQueryRenderer(app, item.table, item.geometry_column, item.srid, null);
                        //Create output folders for each service in public/cached_nodetiles to hold any cached tiles from dynamic service
                        //mapnik.createCachedFolder(item.table);
                    })(item);
                });
            }
        }
    });


    var sessionStart = new Date().toLocaleString();

    //Load tile rendering statistics
    app.get('/admin', function (req, res) {
        res.writeHead(200, {
            'Content-Type': 'text/plain'
        });

        var resultString = "Active Session started at: " + sessionStart + "\n\n\nUse ?reset=true to reset the stats\n\n\n";

        var args = req.query;
        if (args.reset) {
            //Reset the stats.
            clearStatsObject(PGTileStats);
            clearStatsObject(ShapeTileStats);
            clearStatsObject(RasterTileStats);
            resultString += "Session Stats reset by user. \n\n\n";
        }


        //Get the average render time for each type
        resultString += generateStatsString(PGTileStats, "PostGIS");
        resultString += generateStatsString(ShapeTileStats, "Shapefile");
        resultString += generateStatsString(RasterTileStats, "Raster");

        var cacheLength = (cacher.client.keys().length/2);
        var cacheSize = common.roughSizeOfObject(cacher.client.values())/1000;

        resultString += cacheLength.toString() + " tiles stored in cache, with a size of roughly " + cacheSize + " KB.";
        resultString += "\n...That's an average of " + (cacheSize/cacheLength || 0) + "KB/tile. (This is usually too high)."


        res.end(resultString);
    });

    return app;
};

function generateStatsString(statsObject, sourceName) {
    var message = "";
    var tileType;

    Object.keys(statsObject).forEach(function (source) {
        switch (source) {
            case "SingleTiles":
                tileType = "Single Tile";
                break;
            case "MultiTiles":
                tileType = "Multi Tiles";
                break;
            case "VectorTiles":
                tileType = "Vector Tiles";
                break;
            case "MemoryTiles":
                tileType = "In-Memory Tiles";
                break;
        }

        var StatTypeObject = statsObject[source];

        if (StatTypeObject.times.length > 0) {
            var totalTime = StatTypeObject.times.reduce(function (previousValue, currentValue, index, array) {
                return parseInt(previousValue) + parseInt(currentValue);
            });
            totalTime = totalTime / 1000;
            var averageTime = totalTime / StatTypeObject.times.length;
            message += tileType + " - " + sourceName + ": For this session, " + StatTypeObject.times.length + " tiles were generated in " + totalTime + " seconds with an average time of " + averageTime + " seconds/tile.\n";
        } else {
            message += tileType + " - " + sourceName + ": 0 tiles rendered.\n";
        }
    });

    //New section
    message += "\n\n";

    return message;
}

function clearStatsObject(performanceObject) {
    performanceObject.SingleTiles.times = [];
    performanceObject.MultiTiles.times = [];
    performanceObject.VectorTiles.times = [];
    performanceObject.MemoryTiles.times = [];
}

exports.createCachedFolder = function (table) {
    var folder = './public/cached_nodetiles/' + table;
    //create a folder for this table in public/cached_nodetiles if it doesn't exist
    fs.exists(folder, function (exists) {
        if (exists === false) {
            //make it
            console.log("Didn't find cache folder.  Tyring to make folder: " + folder);
            fs.mkdir(folder, function () {
                console.log("Made " + folder);
            });
            //Synch
        }
    });
};

//Create a static renderer that will always use the default styling
//This only works for tables, not views (since Mapnik requires that VACUUM ANALYZE be run for stats on the table to be rendered)
exports.createPGTileRenderer = flow.define(function (app, settings) {

    this.app = app;
    this.settings = settings;
    this.epsg = epsgSRID;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mss/xml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style.xml";
            //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    //Vacuum Analyze needs to be run on every table in the DB.
    var postgis_settings = {
        'host': settings.pg.server,
        'port': settings.pg.port,
        'dbname': settings.pg.database,
        'table': this.table,
        'user': settings.pg.username,
        'password': settings.pg.password,
        'type': 'postgis',
        'estimate_extent': 'true'
    };

    var _self = this;

    //Create Route for this table
    this.app.all('/services/tables/' + _self.table + '/dynamicMap', function (req, res) {

        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        parseXYZ(req, TMS_SCHEME, function (err, params) {
            if (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            } else {
                try {
                    //create map and layer
                    var map = new mapnik.Map(256, 256, mercator.proj4);
                    var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                    //check to see if 3857.  If not, assume WGS84
                    var postgis = new mapnik.Datasource(postgis_settings);
                    var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

                    layer.datasource = postgis;
                    layer.styles = [_self.table, 'style'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {
                        if (err)
                            throw err;
                        map.add_layer(layer);
                        console.log(map.toXML());
                        // Debug settings

                        map.extent = bbox;
                        var im = new mapnik.Image(map.width, map.height);
                        map.render(im, function (err, im) {

                            if (err) {
                                throw err;
                            } else {
                                var duration = Date.now() - startTime;
                                PGTileStats.times.push(duration);
                                res.writeHead(200, {
                                    'Content-Type': 'image/png'
                                });
                                res.end(im.encodeSync('png'));
                            }
                        });
                    });

                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                }
            }
        });
    });

    console.log("Created dynamic service: " + '/services/tables/' + _self.table + '/dynamicMap');
});

//Create a renderer that will accept dynamic queries and styling and bring back a single image to fit the map's extent.
exports.createPGTileQueryRenderer = flow.define(function (app, table, geom_field, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.geom_field = geom_field;
    this.epsg = epsgSRID;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style" + styleExtension;
            ; //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    //Create Route for this table
    this.app.all('/services/tables/' + _self.table + '/dynamicQueryMap', function (req, res) {
        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        //Check for correct args
        //Needs: width (px), height (px), bbox (xmin, ymax, xmax, ymin), where, optional styling
        var args = {};

        //Grab POST or QueryString args depending on type
        if (req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            args = req.body;
        } else if (req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            args = req.query;
        }

        // check to see if args were provided
        if (JSON.stringify(args) != '{}') {
            //are all mandatory args provided?
            var missing = "Please provide";
            var missingArray = [];
            if (!args.width) {
                missingArray.push("width");
            }

            if (!args.height) {
                missingArray.push("height");
            }

            if (!args.bbox) {
                missingArray.push("bbox");
            }

            if (missingArray.length > 0) {
                missing += missingArray.join(", ");
                //respond with message.
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(missing);
                return;
            }

            //If user passes in where clause, then build the query here and set it with the table property of postgis_settings
            if (args.where) {
                //Validate where - TODO
            }

            //Vacuum Analyze needs to be run on every table in the DB.
            //Also, data should be in 3857 SRID
            var postgis_settings = {
                'host': settings.pg.server,
                'port': settings.pg.port,
                'dbname': settings.pg.database,
                'table': (args.where ? "(SELECT " + _self.geom_field + " from " + _self.table + " WHERE " + args.where + ") as " + _self.table : _self.table),
                'user': settings.pg.username,
                'password': settings.pg.password,
                'type': 'postgis',
                'estimate_extent': 'true'
            };

            //We're all good. Make the picture.
            try {

                //create map and layer
                var map = new mapnik.Map(parseInt(args.width), parseInt(args.height), mercator.proj4);
                //width, height
                var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                //check to see if 3857.  If not, assume WGS84
                var postgis = new mapnik.Datasource(postgis_settings);

                var floatbbox = args.bbox.split(",");

                var bbox = [floatbbox[0], floatbbox[1], floatbbox[2], floatbbox[3]];
                //ll lat, ll lon, ur lat, ur lon

                layer.datasource = postgis;
                layer.styles = [_self.table, 'style'];

                map.bufferSize = 64;

                map.load(path.join(fullpath), {
                    strict: true
                }, function (err, map) {

                    console.log(map.toXML());
                    // Debug settings

                    map.add_layer(layer);

                    map.extent = bbox;
                    var im = new mapnik.Image(map.width, map.height);
                    map.render(im, function (err, im) {

                        if (err) {
                            throw err;
                        } else {
                            var duration = Date.now() - startTime;
                            SingleTileStats.times.push(duration);
                            res.writeHead(200, {
                                'Content-Type': 'image/png'
                            });
                            res.end(im.encodeSync('png'));
                        }
                    });
                });

            } catch (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            }

        } else {
            //if no args, pass to regular tile renderer
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end("Need to supply height, width and bbox arguments.");
        }
    });

    console.log("Created dynamic query service: " + '/services/tables/' + _self.table + '/dynamicQueryMap');
});

//Create a renderer that will accept dynamic GeoJSON Objects and styling and bring back a single image to fit the map's extent.
exports.createGeoJSONQueryRenderer = flow.define(function (app, geoJSON, epsgSRID, cartoFile, id, callback) {

    this.app = app;
    this.geoJSON = geoJSON;
    //this.geom_field = geom_field;
    this.epsg = epsgSRID;

    var _self = this;
    var dynamicURL = '/services/GeoJSONQueryMap/' + id;

    //Create Route for this table - TODO:  Figure out how/when to kill this endpoint
    this.app.all(dynamicURL, function (req, res) {

        //Check for correct args
        //Needs: width (px), height (px), bbox (xmin, ymax, xmax, ymin), where, optional styling
        var args = {};

        //Grab POST or QueryString args depending on type
        if (req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            args = req.body;
        } else if (req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            args = req.query;
        }

        // check to see if args were provided
        if (JSON.stringify(args) != '{}') {
            //are all mandatory args provided?
            var missing = "Please provide";
            var missingArray = [];
            if (!args.width) {
                missingArray.push("width");
            }

            if (!args.height) {
                missingArray.push("height");
            }

            if (!args.bbox) {
                missingArray.push("bbox");
            }

            if (missingArray.length > 0) {
                missing += missingArray.join(", ");
                //respond with message.
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(missing);
                return;
            }

            //If user passes in geojson
            if (args.geojson) {
                //Validate where - TODO
            }

            //make a temporary geojson file for mapnik (until I figure out how to pass in an object)
            common.writeGeoJSONFile(geoJSON, id, function (err, filename, fullpath) {

                if (err) {
                    //TODO: Handle this.
                    return;
                }

                if (fullpath) {

                    var geojson_settings = {
                        type: 'geojson',
                        file: fullpath
                    };

                    //We're all good. Make the picture.
                    try {
                        //create map and layer
                        var map = new mapnik.Map(parseInt(args.width), parseInt(args.height), mercator.proj4);
                        //width, height
                        var layer = new mapnik.Layer(id, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                        //check to see if 3857.  If not, assume WGS84
                        var geojson_ds = new mapnik.Datasource(geojson_settings);

                        var floatbbox = args.bbox.split(",");

                        var bbox = [floatbbox[0], floatbbox[1], floatbbox[2], floatbbox[3]];
                        //ll lat, ll lon, ur lat, ur lon

                        layer.datasource = geojson_ds;
                        layer.styles = [id, 'style'];

                        map.bufferSize = 64;

                        var stylepath = __dirname + '/cartocss/style.xml';

                        map.load(path.join(stylepath), {
                            strict: true
                        }, function (err, map) {

                            if (err)
                                throw err;
                            map.add_layer(layer);

                            console.log(map.toXML());
                            // Debug settings

                            map.extent = bbox;
                            var im = new mapnik.Image(map.width, map.height);
                            map.render(im, function (err, im) {

                                if (err) {
                                    throw err;
                                } else {
                                    res.writeHead(200, {
                                        'Content-Type': 'image/png'
                                    });
                                    res.end(im.encodeSync('png'));
                                }
                            });
                        });
                    } catch (err) {
                        res.writeHead(500, {
                            'Content-Type': 'text/plain'
                        });
                        res.end(err.message);
                    }
                }

            });

        } else {
            //if no args, pass to regular tile renderer
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end("Need to supply height, width and bbox arguments.");
        }
    });

    console.log("Created dynamic query service: " + dynamicURL);
    callback({
        imageURL: dynamicURL
    });
});

//Create a renderer that will accept dynamic GeoJSON Objects and styling and bring back a single image to fit the map's extent.
exports.createImageFromGeoJSON = flow.define(function (geoJSON, bbox, epsgSRID, cartoFile, callback) {

    this.geoJSON = geoJSON;
    //this.geom_field = geom_field;
    this.epsg = epsgSRID;

    var _self = this;

    //Check for correct args
    //Needs: geojson, bbox (xmin, ymax, xmax, ymin)
    var args = {
        width: 500,
        height: 500
    };

    //make a temporary geojson file for mapnik (until I figure out how to pass in an object)
    common.writeGeoJSONFile(geoJSON, "geojson", function (err, filename, fullpath) {

        if (err) {
            //TODO: Handle this.
            return;
        }

        if (fullpath) {

            var geojson_settings = {
                type: 'geojson',
                file: fullpath
            };

            //We're all good. Make the picture.
            try {
                //create map and layer
                var map = new mapnik.Map(parseInt(args.width), parseInt(args.height), geographic.proj4);
                //width, height
                var layer = new mapnik.Layer("geojson", ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                //check to see if 3857.  If not, assume WGS84
                var geojson_ds = new mapnik.Datasource(geojson_settings);

                var bboxArray = [bbox.xmin, bbox.ymax, bbox.xmax, bbox.ymin];

                layer.datasource = geojson_ds;
                layer.styles = ["geojson", 'style'];

                map.bufferSize = 64;

                var stylepath = __dirname + '/cartocss/style.xml';

                map.load(path.join(stylepath), {
                    strict: true
                }, function (err, map) {

                    console.log(map.toXML());
                    // Debug settings

                    if (err)
                        throw err;
                    map.add_layer(layer);

                    map.extent = bboxArray;
                    var im = new mapnik.Image(map.width, map.height);
                    map.render(im, callback);
                });
            } catch (err) {
                callback(err, null);
            }
        }

    });
});

//This should take in a geoJSON object and create a new route on the fly - return the URL?
exports.createDynamicGeoJSONEndpoint = function (geoJSON, name, epsgSRID, cartoCssFile) {
    //var map = new nodetiles.Map();

    //map.assetsPath = path.join(__dirname, "cartocss"); //This is the cartoCSS path

    ////Adding a static GeoJSON file
    //map.addData(new DynamicGeoJsonSource({
    //	name: "world", //same name used in cartoCSS class (#world)
    //	geoJSONObject: geoJSON,
    //	projection: "EPSG:" + epsgSRID
    //}));

    //map.addStyle(fs.readFileSync(__dirname + '/cartocss/' + cartoCssFile, 'utf8'));

    //app.use('/services/nodetiles/' + name + '/tiles', nodetiles.route.tilePng({ map: map })); // tile.png
    //console.log("Created dynamic service: " + '/services/nodetiles/' + name + '/tiles');
};

//Create a static renderer that will always use the default styling
var createShapefileTileRenderer = exports.createShapefileTileRenderer = flow.define(
    function (app, table, path_to_shp, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.epsg = epsgSRID;
    this.path_to_shp = path_to_shp;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mss/xml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style.xml";
            //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    //Create Route for this table
    this.app.all('/services/shapefiles/' + _self.table + '/dynamicMap', function (req, res) {
        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        parseXYZ(req, TMS_SCHEME, function (err, params) {
            if (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            } else {
                try {

                    var map = new mapnik.Map(256, 256, mercator.proj4);

                    var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                    //check to see if 3857.  If not, assume WGS84
                    var shapefile = new mapnik.Datasource({
                        type: 'shape',
                        file: _self.path_to_shp
                    });
                    var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

                    layer.datasource = shapefile;
                    layer.styles = [_self.table, 'style'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {
                        if (err)
                            throw err;

                        map.add_layer(layer);

                        console.log(map.toXML());
                        // Debug settings

                        map.extent = bbox;
                        var im = new mapnik.Image(map.width, map.height);
                        map.render(im, function (err, im) {
                            if (err) {
                                throw err;
                            } else {
                                var duration = Date.now() - startTime;
                                ShapeStats.times.push(duration);
                                res.writeHead(200, {
                                    'Content-Type': 'image/png'
                                });
                                res.end(im.encodeSync('png'));
                            }
                        });

                    });

                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                }
            }
        });
    });

    console.log("Created dynamic shapefile service: " + '/services/shapefiles/' + _self.table + '/dynamicMap');
});

//Create a renderer that will  bring back a single image to fit the map's extent.
var createShapefileSingleTileRenderer = exports.createShapefileSingleTileRenderer = flow.define(
    function (app, table, path_to_shp, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.path_to_shp = path_to_shp;
    this.epsg = epsgSRID;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style" + styleExtension;
            ; //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    //Create Route for this table
    this.app.all('/services/shapefiles/' + _self.table + '/dynamicQueryMap', cacher.cache('days', 1), function (req, res) {
        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        //Check for correct args
        //Needs: width (px), height (px), bbox (xmin, ymax, xmax, ymin), where, optional styling
        var args = {};

        //Grab POST or QueryString args depending on type
        if (req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            args = req.body;
        } else if (req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            args = req.query;
        }

        // check to see if args were provided
        if (JSON.stringify(args) != '{}') {
            //are all mandatory args provided?
            var missing = "Please provide";
            var missingArray = [];
            if (!args.width) {
                missingArray.push("width");
            }

            if (!args.height) {
                missingArray.push("height");
            }

            if (!args.bbox) {
                missingArray.push("bbox");
            }

            if (missingArray.length > 0) {
                missing += missingArray.join(", ");
                //respond with message.
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(missing);
                return;
            }

            //If user passes in where clause, then build the query here and set it with the table property of postgis_settings
            if (args.where) {
                //Validate where - TODO
            }

            //We're all good. Make the picture.
            try {
                //create map and layer
                var map = new mapnik.Map(parseInt(args.width), parseInt(args.height), mercator.proj4);

                //width, height
                var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                //check to see if 3857.  If not, assume WGS84
                var shapefile = new mapnik.Datasource({
                    type: 'shape',
                    file: _self.path_to_shp
                });

                var floatbbox = args.bbox.split(",");

                var bbox = [floatbbox[0], floatbbox[1], floatbbox[2], floatbbox[3]];
                //ll lat, ll lon, ur lat, ur lon

                layer.datasource = shapefile;
                layer.styles = [_self.table, 'style'];
                map.bufferSize = 64;

                map.load(path.join(fullpath), {
                    strict: true
                }, function (err, map) {

                    map.add_layer(layer);

                    console.log(map.toXML());
                    // Debug settings

                    map.extent = bbox;
                    var im = new mapnik.Image(map.width, map.height);
                    map.render(im, function (err, im) {

                        if (err) {
                            throw err;
                        } else {
                            var duration = Date.now() - startTime;
                            ShapeSingleTileStats.times.push(duration);
                            res.writeHead(200, {
                                'Content-Type': 'image/png'
                            });
                            res.end(im.encodeSync('png'));
                        }
                    });
                });

            } catch (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            }

        } else {
            //if no args, pass to regular tile renderer
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end("Need to supply width, height and bbox arguments.");

        }
    });

    console.log("Created dynamic query service: " + '/services/shapefiles/' + _self.table + '/dynamicQueryMap');
});


//Create a static renderer, using in-memory shapefile
var createMemoryShapefileTileRenderer = exports.createMemoryShapefileTileRenderer = flow.define(
    function (app, table, memoryDatasource, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.epsg = epsgSRID;
    this.memoryDatasource = memoryDatasource;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mss/xml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style.xml";
            //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    //Create Route for this table
    this.app.all('/services/memshapefiles/' + _self.table + '/dynamicMap', function (req, res) {
        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        parseXYZ(req, TMS_SCHEME, function (err, params) {
            if (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            } else {
                try {

                    var map = new mapnik.Map(256, 256, mercator.proj4);

                    var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));

                    var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

                    layer.datasource = _self.memoryDatasource;
                    layer.styles = [_self.table, 'style'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {
                        if (err)
                            throw err;

                        map.add_layer(layer);

                        console.log(map.toXML());
                        // Debug settings

                        map.extent = bbox;
                        var im = new mapnik.Image(map.width, map.height);
                        map.render(im, function (err, im) {
                            if (err) {
                                throw err;
                            } else {
                                var duration = Date.now() - startTime;
                                MemShapeStats.times.push(duration);
                                res.writeHead(200, {
                                    'Content-Type': 'image/png'
                                });
                                res.end(im.encodeSync('png'));
                            }
                        });

                    });

                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                }
            }
        });
    });

    console.log("Created in-memory shapefile service: " + '/services/memshapefiles/' + _self.table + '/dynamicMap');
});


//Create a renderer that will  bring back a single image to fit the map's extent, using in-memory features read from a shapefile.
var createMemoryShapefileSingleTileRenderer = exports.createMemoryShapefileSingleTileRenderer = flow.define(function (app, table, memoryDatasource, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.memoryDatasource = memoryDatasource;
    this.epsg = epsgSRID;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style" + styleExtension;
            ; //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    //Create Route for this table
    this.app.all('/services/memshapefiles/' + _self.table + '/dynamicQueryMap', function (req, res) {
        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        //Check for correct args
        //Needs: width (px), height (px), bbox (xmin, ymax, xmax, ymin), where, optional styling
        var args = {};

        //Grab POST or QueryString args depending on type
        if (req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            args = req.body;
        } else if (req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            args = req.query;
        }

        // check to see if args were provided
        if (JSON.stringify(args) != '{}') {
            //are all mandatory args provided?
            var missing = "Please provide";
            var missingArray = [];
            if (!args.width) {
                missingArray.push("width");
            }

            if (!args.height) {
                missingArray.push("height");
            }

            if (!args.bbox) {
                missingArray.push("bbox");
            }

            if (missingArray.length > 0) {
                missing += missingArray.join(", ");
                //respond with message.
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(missing);
                return;
            }

            //If user passes in where clause, then build the query here and set it with the table property of postgis_settings
            if (args.where) {
                //Validate where - TODO
            }

            //We're all good. Make the picture.
            try {
                //create map and layer
                var map = new mapnik.Map(parseInt(args.width), parseInt(args.height), mercator.proj4);

                //width, height
                var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));

                var floatbbox = args.bbox.split(",");

                var bbox = [floatbbox[0], floatbbox[1], floatbbox[2], floatbbox[3]];
                //ll lat, ll lon, ur lat, ur lon

                layer.datasource = _self.memoryDatasource;
                layer.styles = [_self.table, 'style'];
                map.bufferSize = 64;

                map.load(path.join(fullpath), {
                    strict: true
                }, function (err, map) {

                    map.add_layer(layer);

                    console.log(map.toXML());
                    // Debug settings

                    map.extent = bbox;
                    var im = new mapnik.Image(map.width, map.height);
                    map.render(im, function (err, im) {

                        if (err) {
                            throw err;
                        } else {
                            var duration = Date.now() - startTime;
                            MemShapeSingleTileStats.times.push(duration);
                            res.writeHead(200, {
                                'Content-Type': 'image/png'
                            });
                            res.end(im.encodeSync('png'));
                        }
                    });
                });

            } catch (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            }

        } else {
            //if no args, pass to regular tile renderer
            res.writeHead(500, {
                'Content-Type': 'text/plain'
            });
            res.end("Need to supply width, height and bbox arguments.");

        }
    });

    console.log("Created in-memory shapefile query service: " + '/services/memshapefiles/' + _self.table + '/dynamicQueryMap');
});

function createInMemoryDatasource(name, path_to_shp) {
    var shapefile = new mapnik.Datasource({
        type: 'shape',
        file: path_to_shp
    });

    // get the featureset that exposes lazy next() iterator
    var featureset = shapefile.featureset();

    var mem_datasource = new mapnik.MemoryDatasource(
        {}
    );

    // build up memory datasource
    while (( feat = featureset.next(true))) {
        var e = feat.extent();
        // center longitude of polygon bbox
        var x = (e[0] + e[2]) / 2;
        // center latitude of polygon bbox
        var y = (e[1] + e[3]) / 2;
        var attr = feat.attributes();
        mem_datasource.add({
            'x': x,
            'y': y,
            'properties': {
                'feat_id': feat.id()//,
                //'NAME' : attr.NAME,
                //'POP2005' : attr.POP2005
            }
        });
    }

    return mem_datasource;

}


//Create a static renderer that will always use the default styling
exports.createPGVectorTileRenderer = flow.define(function (app, table, geom_field, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.epsg = epsgSRID;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mss/xml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style.xml";
            //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    //Vacuum Analyze needs to be run on every table in the DB.
    var postgis_settings = {
        'host': settings.pg.server,
        'port': settings.pg.port = '5432',
        'dbname': settings.pg.database,
        'table': this.table,
        'user': settings.pg.username,
        'password': settings.pg.password,
        'type': 'postgis',
        'estimate_extent': 'true'
    };

    var _self = this;

    //Create Route for this table
    this.app.all('/services/tables/' + _self.table + '/vector-tiles', function (req, res) {

        parseXYZ(req, TMS_SCHEME, function (err, params) {

            if (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            } else {
                try {

                    //create map and layer
                    var map = new mapnik.Map(256, 256, mercator.proj4);
                    var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                    //check to see if 3857.  If not, assume WGS84
                    var postgis = new mapnik.Datasource(postgis_settings);
                    var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

                    layer.datasource = postgis;
                    layer.styles = [_self.table, 'style'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {

                        //From Tilelive-Bridge - getTile
                        // set source _maxzoom cache to prevent repeat calls to map.parameters
                        if (_self._maxzoom === undefined) {
                            _self._maxzoom = map.parameters.maxzoom ? parseInt(map.parameters.maxzoom, 10) : 14;
                        }

                        var opts = {};
                        // use tolerance of 32 for zoom levels below max
                        opts.tolerance = params.z < _self._maxzoom ? 32 : 0;
                        // make larger than zero to enable
                        opts.simplify = 0;
                        // 'radial-distance', 'visvalingam-whyatt', 'zhao-saalfeld' (default)
                        opts.simplify_algorithm = 'radial-distance';

                        var headers = {};
                        headers['Content-Type'] = 'application/x-protobuf';
                        if (_self._deflate)
                            headers['Content-Encoding'] = 'deflate';

                        map.add_layer(layer);

                        //map.resize(256, 256);
                        map.extent = bbox;
                        // also pass buffer_size in options to be forward compatible with recent node-mapnik
                        // https://github.com/mapnik/node-mapnik/issues/175
                        opts.buffer_size = map.bufferSize;

                        map.render(new mapnik.VectorTile(+params.z, +params.x, +params.y), opts, function (err, image) {

                            //immediate(function() {
                            //	source._map.release(map);
                            //});

                            if (err)
                                return callback(err);
                            // Fake empty RGBA to the rest of the tilelive API for now.
                            image.isSolid(function (err, solid, key) {
                                if (err) {
                                    res.writeHead(500, {
                                        'Content-Type': 'text/plain'
                                    });

                                    res.end(err.message);
                                    return;
                                }
                                // Solid handling.
                                var done = function (err, buffer) {
                                    if (err) {
                                        res.writeHead(500, {
                                            'Content-Type': 'text/plain'
                                        });

                                        res.end(err.message);
                                        return;
                                    }

                                    if (solid === false) {
                                        //return callback(err, buffer, headers);
                                        res.setHeader('content-encoding', 'deflate');
                                        res.setHeader('content-type', 'application/octet-stream');
                                        res.send(buffer); //return response
                                        return;
                                    }

                                    // Empty tiles are equivalent to no tile.
                                    if (_self._blank || !key) {
                                        res.writeHead(500, {
                                            'Content-Type': 'text/plain'
                                        });

                                        res.end('Tile does not exist');
                                        return;
                                    }

                                    // Fake a hex code by md5ing the key.
                                    var mockrgb = crypto.createHash('md5').update(buffer).digest('hex').substr(0, 6);
                                    buffer.solid = [parseInt(mockrgb.substr(0, 2), 16), parseInt(mockrgb.substr(2, 2), 16), parseInt(mockrgb.substr(4, 2), 16), 1].join(',');
                                    res.send(buffer);
                                    //return callback(err, buffer, headers);
                                };
                                // No deflate.
                                return !_self._deflate ? done(null, image.getData()) : zlib.deflate(image.getData(), done);
                            });
                        });
                    });
                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });

                    res.end(err.message);
                }
            }
        });
    });

    console.log("Created vector tile service: " + '/services/tables/' + _self.table + '/vector-tiles');
});


//Create a static renderer that will always use the default styling
var createRasterTileRenderer = exports.createRasterTileRenderer = flow.define(function (app, table, path_to_raster, epsgSRID, cartoFile) {

    this.app = app;
    this.table = table;
    this.epsg = epsgSRID;
    this.path_to_raster = path_to_raster;

    var name;
    var stylepath = __dirname + '/cartocss/';
    var fullpath = "";

    //Set the path to the style file
    if (cartoFile) {
        //Passed in
        fullpath = stylepath + cartoFile;
    } else {
        //default
        fullpath = stylepath + table + styleExtension;
    }

    var flo = this;

    //See if there is a <tablename>.mss/xml file for this table.
    //See if file exists on disk.  If so, then use it, otherwise, render it and respond.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = stylepath + "style.xml";
            //Default
        }

        flo(fullpath);
        //flow to next function
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    //Create Route for this table
    this.app.all('/services/rasters/' + _self.table + '/dynamicMap', function (req, res) {
        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        parseXYZ(req, TMS_SCHEME, function (err, params) {
            if (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            } else {
                try {

                    var map = new mapnik.Map(256, 256, mercator.proj4);

                    var layer = new mapnik.Layer(_self.table, ((_self.epsg && (_self.epsg == 3857 || _self.epsg == 3587)) ? mercator.proj4 : geographic.proj4));
                    //check to see if 3857.  If not, assume WGS84

                    var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

                    var raster = new mapnik.Datasource({
                        type: 'gdal',
                        file: _self.path_to_raster,
                        band: 1
                    });

                    layer.datasource = raster;
                    layer.styles = [_self.table, 'raster'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {
                        if (err)
                            throw err;

                        map.add_layer(layer);

                        console.log(map.toXML());
                        // Debug settings

                        map.extent = bbox;
                        var im = new mapnik.Image(map.width, map.height);
                        map.render(im, function (err, im) {
                            if (err) {
                                throw err;
                            } else {
                                var duration = Date.now() - startTime;
                                RasterStats.times.push(duration);
                                res.writeHead(200, {
                                    'Content-Type': 'image/png'
                                });
                                res.end(im.encodeSync('png'));
                            }
                        });

                    });

                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                }
            }
        });
    });

    console.log("Created dynamic raster tile service: " + '/services/rasters/' + _self.table + '/dynamicMap');
});


var aquire = function (id, options, callback) {
    methods = {
        create: function (cb) {
            var obj = new mapnik.Map(options.width || 256, options.height || 256, mercator.proj4);
            obj.load(id, {
                strict: true
            }, function (err, obj) {
                if (options.bufferSize) {
                    obj.bufferSize = options.bufferSize;
                }
                cb(err, obj);
            });
        },
        destroy: function (obj) {
            delete obj;
        }
    };
    maps.acquire(id, methods, function (err, obj) {
        callback(err, obj);
    });
};

//Find all shapefiles in the ./endpoints/Mapnik/data/Shapefiles folder.
//Spin up a new endpoint for each one of those.
function getShapeFilePaths(shpLocation) {
    var items = [];
    //Load mbtiles from mbtiles folder.
    require("fs").readdirSync(shpLocation).forEach(function (file) {
        var ext = path.extname(file);
        if (ext == ".shp") {
            items.push(file);
        }
    });

    return items;
}

//Find all shapefiles in the ./endpoints/Mapnik/data/InMemory-Shapefiles folder.
//These are shapefiles that should be loaded into memory when the server starts
function getMemoryShapeFilePaths(shpLocation) {
    var items = [];
    //Load mbtiles from mbtiles folder.
    require("fs").readdirSync(shpLocation).forEach(function (file) {
        var ext = path.extname(file);
        if (ext == ".shp") {
            items.push(file);
        }
    });

    return items;
}

//Find all rasters in the ./endpoints/Mapnik/data/rasters folder.
//Spin up a new endpoint for each one of those.
function getRasterPaths(rasterLocation) {
    var items = [];
    //Load rasters from rasters folder.
    require("fs").readdirSync(rasterLocation).forEach(function (file) {
        var ext = path.extname(file);
        if (ext == ".tiff" || ext == ".tif" || ext == ".geotiff") {
            items.push(file);
        }
    });

    return items;
};


//Generic implementation of multi-tiles
var createMultiTileRoute = exports.createMultiTileRoute = flow.define(
    function (app, routeSettings, performanceObject) {

        this.app = app;
        this.settings = routeSettings;
        this.performanceObject = performanceObject;

        this._stylepath = path.join(__dirname, 'cartocss');

        //Set the path to the style file
        this.fullpath = (this.settings.routeProperties.cartoFile ? path.join(this._stylepath, this.settings.routeProperties.cartoFile) : path.join(this._stylepath, this.settings.routeProperties.name + _styleExtension));

        //See if there is a <name>.xml file for this table.
        fs.stat(this.fullpath, this);
    },
    function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            this.fullpath = path.join(this._stylepath, 'style.xml');
        }
        this(this.fullpath)
    },
    function (fullpath) {
        //Flow in from getting full path to Style file

        var _self = this;

        var route = '/services/' + _self.settings.routeProperties.source + '/' + _self.settings.routeProperties.name + '/dynamicMap/:z/:x/:y.*';

        //Create Route for this table
        this.app.get(route,cacher.cache('day'), function (req, res) {

            //Start Timer to measure response speed for tile requests.
            var startTime = Date.now();

            //Check for correct args
            //Optional: where clause for postgis type
            var args = common.getArguments(req);

            //If user passes in where clause, then build the query here and set it with the table property of postgis_settings
            if (args.where) {
                //Validate where - TODO

                //If a where clause was passed in, and we're using a postgis datasource, allow it
                if (_self.settings.mapnik_datasource.type.toLowerCase() == 'postgis') {
                    _self.settings.mapnik_datasource.table = (args.where ? "(SELECT " + _self.settings.routeProperties.geom_field + " from " + _self.settings.routeProperties.name + " WHERE " + args.where + ") as " + _self.settings.routeProperties.name : _self.settings.routeProperties.name);
                }
            }

            parseXYZ(req, TMS_SCHEME, function (err, params) {
                if (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                } else {
                    try {
                        //create map
                        var map = new mapnik.Map(256, 256, mercator.proj4);

                        //Create Layer. Check to see if 3857.  If not, assume WGS84
                        var layer = new mapnik.Layer(_self.settings.routeProperties.name, ((_self.settings.routeProperties.srid && (_self.settings.routeProperties.srid == 3857 || _self.settings.routeProperties.srid == 3587)) ? mercator.proj4 : geographic.proj4));

                        var datasource = new mapnik.Datasource(_self.settings.mapnik_datasource);

                        var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false, false);

                        layer.datasource = datasource;
                        layer.styles = [_self.settings.routeProperties.name, _self.settings.routeProperties.defaultStyle || 'style'];

                        map.bufferSize = 64;
                        map.load(path.join(fullpath), {
                            strict: true
                        }, function (err, map) {
                            if (err)
                                throw err;

                            map.add_layer(layer);

                            //Write out the map xml
                            console.log(map.toXML());

                            map.extent = bbox;
                            var im = new mapnik.Image(map.width, map.height);
                            map.render(im, function (err, im) {

                                if (err) {
                                    throw err;
                                } else {
                                    var duration = Date.now() - startTime;
                                    _self.performanceObject.times.push(duration);
                                    res.writeHead(200, {
                                        'Content-Type': 'image/png'
                                    });
                                    res.end(im.encodeSync('png'));
                                }
                            });
                        });

                    } catch (err) {
                        res.writeHead(500, {
                            'Content-Type': 'text/plain'
                        });
                        res.end(err.message);
                    }
                }
            });
        });

        console.log("Created multi tile service (" + _self.settings.routeProperties.source + "): " + route);
    }
);


//Generic implementation of multi-tiles
var createSingleTileRoute = exports.createSingleTileRoute = flow.define(
    function (app, routeSettings, performanceObject) {

        this.app = app;
        this.settings = routeSettings;
        this.performanceObject = performanceObject;

        var _stylepath = path.join(__dirname, 'cartocss');

        //Set the path to the style file
        var fullpath = (this.settings.routeProperties.cartoFile ? path.join(_stylepath, this.settings.routeProperties.cartoFile) : _stylepath + this.settings.routeProperties.name + _styleExtension);

        //Save the flow
        var flo = this;

        //See if there is a <name>.xml file for this table.
        fs.stat(fullpath, function (err, stat) {
            if (err) {
                //No file.  Use defaults.
                fullpath = path.join(_stylepath, 'style.xml');
            }
            flo(fullpath);
        });
    }, function (fullpath) {
        //Flow in from getting full path to Style file

        var _self = this;

        var route = '/services/' + _self.settings.routeProperties.source + '/' + _self.settings.routeProperties.name + '/dynamicSingleMap/*';

        //Create Route for this table
        this.app.all(route, cacher.cache('days', 1), function (req, res) {

            //Start Timer to measure response speed for tile requests.
            var startTime = Date.now();

            //Check for correct args
            //Needs: width (px), height (px), bbox (xmin, ymax, xmax, ymin), where, optional styling
            var args = common.getArguments(req);

            // check to see if args were provided
            if (JSON.stringify(args) != '{}') {
                //are all mandatory args provided?
                var missing = "Please provide";
                var missingArray = [];
                if (!args.width) {
                    missingArray.push("width");
                }

                if (!args.height) {
                    missingArray.push("height");
                }

                if (!args.bbox) {
                    missingArray.push("bbox");
                }

                if (missingArray.length > 0) {
                    missing += missingArray.join(", ");
                    //respond with message.
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(missing);
                    return;
                }

                //If user passes in where clause, then build the query here and set it with the table property of postgis_settings
                if (args.where) {
                    //Validate where - TODO

                    //If a where clause was passed in, and we're using a postgis datasource, allow it
                    if (_self.settings.mapnik_datasource.type.toLowerCase() == 'postgis') {
                        _self.settings.mapnik_datasource.table = (args.where ? "(SELECT " + _self.settings.routeProperties.geom_field + " from " + _self.settings.routeProperties.name + " WHERE " + args.where + ") as " + _self.settings.routeProperties.name : _self.settings.routeProperties.name);
                    }
                }

                //We're all good. Make the picture.
                try {
                    //create map and layer
                    var map = new mapnik.Map(parseInt(args.width), parseInt(args.height), mercator.proj4);

                    //width, height
                    var layer = new mapnik.Layer(_self.settings.routeProperties.name, ((_self.settings.routeProperties.srid && (_self.settings.routeProperties.srid == 3857 || _self.settings.routeProperties.srid == 3587)) ? mercator.proj4 : geographic.proj4));

                    var floatbbox = args.bbox.split(",");

                    //ll lat, ll lon, ur lat, ur lon
                    var bbox = [floatbbox[0], floatbbox[1], floatbbox[2], floatbbox[3]];

                    var datasource = new mapnik.Datasource(_self.settings.mapnik_datasource);

                    layer.datasource = datasource;
                    layer.styles = [_self.settings.routeProperties.name, _self.settings.routeProperties.defaultStyle || 'style'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {
                        if (err)
                            throw err;

                        map.add_layer(layer);

                        //Write out the map xml
                        console.log(map.toXML());

                        map.extent = bbox;
                        var im = new mapnik.Image(map.width, map.height);
                        map.render(im, function (err, im) {

                            if (err) {
                                throw err;
                            } else {
                                var duration = Date.now() - startTime;
                                _self.performanceObject.times.push(duration);
                                res.writeHead(200, {
                                    'Content-Type': 'image/png'
                                });
                                res.end(im.encodeSync('png'));
                            }
                        });
                    });

                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                }
            }
            else {
                //No args provided
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end("Needs args width, height and bbox.");
                return;
            }
        });

        console.log("Created single tile service (" + _self.settings.routeProperties.source + "): " + route);
    });


//Generic implementation of vector tiles
var createVectorTileRoute = exports.createVectorTileRoute = flow.define(function (app, settings, performanceObject) {

    this.app = app;
    this.settings = settings;
    this.performanceObject = performanceObject;

    var _stylepath = path.join(__dirname, 'cartocss');

    //Set the path to the style file
    var fullpath = (this.settings.routeProperties.cartoFile ? path.join(_stylepath, this.settings.routeProperties.cartoFile) : _stylepath + this.settings.routeProperties.name + _styleExtension);

    //Save the flow
    var flo = this;

    //See if there is a <name>.xml file for this table.
    fs.stat(fullpath, function (err, stat) {
        if (err) {
            //No file.  Use defaults.
            fullpath = path.join(_stylepath, 'style.xml');
        }
        flo(fullpath);
    });
}, function (fullpath) {
    //Flow from after getting full path to Style file

    var _self = this;

    var route = '/services/' + _self.settings.routeProperties.source + '/' + _self.settings.routeProperties.name + '/vector-tiles/:z/:x/:y.*';

    //Create Route for this table
    this.app.all(route, function (req, res) {

        //Start Timer to measure response speed for tile requests.
        var startTime = Date.now();

        var args = common.getArguments(req);

        //If user passes in where clause, then build the query here and set it with the table property of postgis_settings
        if (args.where) {
            //Validate where - TODO

            //If a where clause was passed in, and we're using a postgis datasource, allow it
            if (_self.settings.mapnik_datasource.type.toLowerCase() == 'postgis') {
                _self.settings.mapnik_datasource.table = (args.where ? "(SELECT " + _self.settings.routeProperties.geom_field + " from " + _self.settings.routeProperties.name + " WHERE " + args.where + ") as " + _self.settings.routeProperties.name : _self.settings.routeProperties.name);
            }
        }

        parseXYZ(req, TMS_SCHEME, function (err, params) {

            if (err) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end(err.message);
            } else {
                try {
                    //create map
                    var map = new mapnik.Map(256, 256, mercator.proj4);

                    //Create Layer. Check to see if 3857.  If not, assume WGS84
                    var layer = new mapnik.Layer(_self.settings.routeProperties.name, ((_self.settings.routeProperties.srid && (_self.settings.routeProperties.srid == 3857 || _self.settings.routeProperties.srid == 3587)) ? mercator.proj4 : geographic.proj4));

                    var datasource = new mapnik.Datasource(_self.settings.mapnik_datasource);

                    var bbox = mercator.xyz_to_envelope(parseInt(params.x), parseInt(params.y), parseInt(params.z), false);

                    layer.datasource = datasource;
                    layer.styles = [_self.settings.routeProperties.name, _self.settings.routeProperties.defaultStyle || 'style'];

                    map.bufferSize = 64;
                    map.load(path.join(fullpath), {
                        strict: true
                    }, function (err, map) {

                        //From Tilelive-Bridge - getTile
                        // set source _maxzoom cache to prevent repeat calls to map.parameters
                        if (_self._maxzoom === undefined) {
                            _self._maxzoom = map.parameters.maxzoom ? parseInt(map.parameters.maxzoom, 10) : 14;
                        }

                        var opts = {};
                        // use tolerance of 32 for zoom levels below max
                        opts.tolerance = params.z < _self._maxzoom ? 32 : 0;
                        // make larger than zero to enable
                        opts.simplify = 0;
                        // 'radial-distance', 'visvalingam-whyatt', 'zhao-saalfeld' (default)
                        opts.simplify_algorithm = 'radial-distance';

                        res.setHeader('Content-Type', 'application/x-protobuf');
                        res.setHeader('Content-Encoding', 'deflate');

                        map.add_layer(layer);

                        //map.resize(256, 256);
                        map.extent = bbox;
                        // also pass buffer_size in options to be forward compatible with recent node-mapnik
                        // https://github.com/mapnik/node-mapnik/issues/175
                        opts.buffer_size = map.bufferSize;

                        map.render(new mapnik.VectorTile(+params.z, +params.x, +params.y), opts, function (err, image) {

                            //immediate(function() {
                            //	source._map.release(map);
                            //});

                            if (err)
                                return callback(err);
                            // Fake empty RGBA to the rest of the tilelive API for now.
                            image.isSolid(function (err, solid, key) {
                                if (err) {
                                    res.writeHead(500, {
                                        'Content-Type': 'text/plain'
                                    });

                                    res.end(err.message);
                                    return;
                                }
                                // Solid handling.
                                var done = function (err, buffer) {
                                    if (err) {
                                        res.writeHead(500, {
                                            'Content-Type': 'text/plain'
                                        });

                                        res.end(err.message);
                                        return;
                                    }

                                    if (solid === false) {
                                        var duration = Date.now() - startTime;
                                        _self.performanceObject.times.push(duration);

                                        res.send(buffer); //return response
                                        return;
                                    }

                                    // Empty tiles are equivalent to no tile.
                                    if (_self._blank || !key) {
                                        res.writeHead(500, {
                                            'Content-Type': 'text/plain'
                                        });

                                        res.end('Tile does not exist');
                                        return;
                                    }

                                    // Fake a hex code by md5ing the key.
                                    var mockrgb = crypto.createHash('md5').update(buffer).digest('hex').substr(0, 6);
                                    buffer.solid = [parseInt(mockrgb.substr(0, 2), 16), parseInt(mockrgb.substr(2, 2), 16), parseInt(mockrgb.substr(4, 2), 16), 1].join(',');
                                    res.send(buffer);

                                };
                                // No deflate.
                                //return !_self._deflate ? done(null, image.getData()) : zlib.deflate(image.getData(), done);
                                //For now, assume we're deflating
                                zlib.deflate(image.getData(), done);
                            });
                        });
                    });
                } catch (err) {
                    res.writeHead(500, {
                        'Content-Type': 'text/plain'
                    });

                    res.end(err.message);
                }
            }
        });
    });

    console.log("Created vector tile service: " + route);
});

