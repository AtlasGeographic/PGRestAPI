PGRestAPI - Ubuntu 12/13 Installation
=========

## Dependencies

* PostGres 9.1 + w/ PostGIS 2.0 +
* topojson
* Cairo - You need to [download](http://www.gtk.org/download/index.php) and install Cairo in order to use the [nodetiles](https://github.com/nodetiles/nodetiles-core) dynamic tile rendering functionality.
* nodetiles-core (on Windows, cloned and built on it's own, then copied to PGRestAPI/node_modules folder)

(Assumes you've got a PostGreSQL 9.1+ and PostGIS 2.0+ is installed somewhere)

###Install Node.js 0.10.x (0.10.15 when this project started)

	sudo apt-get update
	sudo apt-get upgrade
	sudo apt-get install g++ curl libssl-dev apache2-utils git-core
	sudo apt-get install make
	sudo apt-get install python-software-properties
	sudo add-apt-repository ppa:chris-lea/node.js
	sudo apt-get update 
	sudo apt-get install nodejs

###Install Node Package Manager (npm)

	cd /tmp 
	git clone http://github.com/isaacs/npm.git 
	cd npm 
	sudo make install

###Create a directory for the project and clone with GIT (or download [.zip file](https://github.com/spatialdev/PGRestAPI/archive/docs.zip) from GitHub

	sudo mkdir pgisserver  
    git clone https://github.com/spatialdev/PGRestAPI.git


###Installing Cairo (for dynamic map tile capability)

	sudo apt-get install libcairo2-dev

###Navigate to PGRestAPI folder, and npm install
from the console:  
   
	cd PGRestAPI
	sudo npm install

###Alter Existing PostGres User to create Read Only User (if you don't already have one)
To grant read-only permissions for a user (assuming your user is already created):  

	-- Grant access to current tables and views
	GRANT SELECT ON ALL TABLES IN SCHEMA public TO <username>;
	-- Now make sure that's also available on new tables and views by default
	ALTER DEFAULT PRIVILEGES
		IN SCHEMA public -- omit this line to make a default across all schemas
		GRANT SELECT
	ON TABLES 
	TO <username>;

	-- Now do the same for sequences
	GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO <username>;
	ALTER DEFAULT PRIVILEGES
		IN SCHEMA public -- omit this line to make a default across all schemas
		GRANT SELECT, USAGE
	ON SEQUENCES 
	TO <username>;

###Create settings.js file
Copy the settings.js.example file and update the postgres server name, port and username and password to point to your PostGreSQL instance.  

*For security reasons, it is recommended that you use a READ ONLY PostGreSQL User.*

	settings.pg.username = 'username';
	settings.pg.password = 'password';
	settings.pg.server = '127.0.0.1';
	settings.pg.port = '5432';
	settings.pg.database = 'test';

If you're using TileStream to serve static map caches, you can reference that instance:

	settings.tilestream.host = "54.212.254.185";
	settings.tilestream.path = "/api/Tileset";
	settings.tilestream.port = "8888";

Specify whether to show PostGreSQL Views and Tables:

	//Should the API display postgres views?
	settings.displayViews = true;

	//Should the API display postgres tables?
	settings.displayTables = true;

If there are tables or views you don't want published, add them to the 'noFlyList' array:

	//Should the API hide any postgres tables or views?
	settings.pg.noFlyList = ["att_0", "table_1"];


Leave the TopoJSON and GeoJSON output folders as they are.

On my windows installation, I use IIS URL Rewrite module to forward requests from a static IP or domain to "localhost:3000" (my node server and port).
These config sections help the API write out fully qualified URLs using the external IP or domain rather than localhost:3000 (for example, when displaying a hyperlink to a particular web service)

	//Optional.  If you're using port forwarding or URL rewriting, but need to display full URLs to your assets, this will stand in for the host.
	settings.application.publichost = "myhost.com"; //Keep this empty if you want to use the default host
	settings.application.publicport = "80";


###For development purposes, install nodemon
Nodemon monitors your node project, and will automatically restart your node project if there are any file changes.
	
	npm install -g nodemon


###Run the project temporarily using node or nodemon
Start the project (assuming installs have all succeeded and you've created the settings.js file)
	
	node app.js

-or-

	nodemon app.js


###To Run as a 'service' (keeps running after you log off the machine), install forever module

	sudo npm install -g forever

### To run this project using forever:
cd to the PGRestAPI folder, then  
	
	sudo forever start app.js

### To restart forever service

	sudo forever restart 0

### To stop forever service

	sudo forever stop 0

###Install local instance of pancakes yo …

Congratulations!  Everything you need should be installed.  Celebrate by having some Pancakes …

![Mou icon](http://173.201.28.147/pgRESTAPI/chubbs.JPG)