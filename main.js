var app = (function () {

	const projections = {
		geodetic: 'EPSG:4326',
		mercator: 'EPSG:3857',
	};

	const colors = {
		normal: '#141414',
		create: '#00AAFF',
		edit: '#ec7063',
		snap: '#34495e',
	};

	const mapDefaults = {
		latitude: 39.6945,
		longitude: -8.1234,
		zoom: 6,
	};

	let map, vectorLayer, format, defaultCenter, userLocation, featureCollection, main, textarea, modifyInteraction, undoInteraction;

	let lfkey = "zecompadre-wkt";

	let mapControls = {};

	const arcgisLayer = new ol.layer.Tile({
		name: 'Satellite',
		title: 'Satellite',
		source: new ol.source.XYZ({
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			attributions: 'Tiles © <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer">ArcGIS</a>',
		}),
		visible: false,
	});

	const osmLayer = new ol.layer.Tile({
		name: 'Streets',
		title: 'Streets',
		source: new ol.source.OSM(),
		visible: true
	});

	const utilities = {
		/**
		 * Transforms coordinates from one spatial reference system to another.
		 *
		 * This function uses OpenLayers' `ol.proj.transform` method to convert the given coordinates
		 * from one projection to another (e.g., from Mercator to Geodetic).
		 *
		 * @param {Array<number>} coords - The coordinates to be transformed, represented as an array [x, y].
		 * @param {string} from - The source projection's EPSG code (e.g., 'EPSG:3857' for Web Mercator).
		 * @param {string} to - The target projection's EPSG code (e.g., 'EPSG:4326' for WGS 84).
		 * @returns {Array<number>} - The transformed coordinates as an array [x, y].
		 */
		transformCoordinates: (coords, from, to) => ol.proj.transform(coords, from, to),
		/**
		 * Generates HTML for a button image that represents the current visible map layer.
		 *
		 * This function checks which layer (OSM or ArcGIS) is currently visible, retrieves the corresponding
		 * preview image and title, and returns an HTML image element to switch between layers.
		 * 
		 * @returns {string} - The HTML string representing an image button for the visible map layer.
		 */
		layerChangeBtnHtml: () => {
			// Extract common information for OSM and ArcGIS layers
			const osmTitle = osmLayer.get("title") || osmLayer.get("name"); // Fallback to 'name' if 'title' is not available
			const osmImg = osmLayer.getPreview(); // Get OSM layer preview image
			const arcgisTitle = arcgisLayer.get("title") || arcgisLayer.get("name"); // Fallback to 'name' if 'title' is not available
			const arcgisImg = arcgisLayer.getPreview(); // Get ArcGIS layer preview image

			// Determine which layer is currently visible
			const isOsmVisible = osmLayer.getVisible(); // Check if OSM layer is visible
			const imgSrc = isOsmVisible ? arcgisImg : osmImg; // Choose the image based on visible layer
			const imgAlt = isOsmVisible ? arcgisTitle : osmTitle; // Set alternative text based on visible layer
			const imgTitle = imgAlt; // Use the same text for title attribute

			// Return the HTML for the button with the corresponding layer
			return `<img src="${imgSrc}" width="36" height="36" alt="${imgAlt}" title="${imgTitle}" />`;
		},
		/**
		 * Converts a hexadecimal color code to an RGBA color string.
		 *
		 * This function takes a hexadecimal color code (e.g., "#FF5733") and an optional opacity value,
		 * and returns the corresponding RGBA color string with the specified opacity.
		 *
		 * @param {string} hex - The hexadecimal color code, e.g., "#FF5733".
		 * @param {string} [opacity='0.2'] - The opacity level for the color, default is '0.2'.
		 * @returns {string} - The RGBA color string in the format 'rgba(r, g, b, opacity)'.
		 */
		hexToRgbA: (hex, opacity = '0.2') => {
			// Remove the '#' from the hex code if present and parse it to a number
			const bigint = parseInt(hex.replace(/^#/, ''), 16);

			// Extract the red, green, and blue components using bitwise operations
			const r = (bigint >> 16) & 255; // Extract the first 8 bits (red)
			const g = (bigint >> 8) & 255;  // Extract the next 8 bits (green)
			const b = bigint & 255;         // Extract the last 8 bits (blue)

			// Return the color in RGBA format with the specified opacity
			return `rgba(${r}, ${g}, ${b}, ${opacity})`;
		},
		/**
		 * Converts the geometry of a feature to Well-Known Text (WKT) format.
		 *
		 * This function retrieves the geometry of the provided feature, clones it to prevent 
		 * modification of the original geometry, transforms it from Mercator to Geodetic projection, 
		 * and then returns the WKT representation of the transformed geometry.
		 *
		 * @param {Object} feature - The feature object that contains the geometry to be converted.
		 * @param {Object} feature.getGeometry - Method that returns the geometry of the feature.
		 * @returns {string} - The WKT representation of the feature's geometry after transformation.
		 */
		getFeatureWKT: (feature) => {
			// Return an empty string if the feature is undefined or null
			if (!feature) return "";

			// Clone the geometry of the feature to avoid modifying the original
			const geom = feature.getGeometry().clone();

			// Transform the geometry from Mercator to Geodetic projection
			const transformedGeom = geom.transform(projections.mercator, projections.geodetic);

			// Convert the transformed geometry to WKT (Well-Known Text) format
			return format.writeGeometry(transformedGeom);
		},
		/**
		 * Generates a SHA-256 checksum for the given input string.
		 *
		 * @param {string} input - The input string to hash.
		 * @returns {Promise<string>} - The hexadecimal representation of the SHA-256 checksum.
		 */
		generateChecksum: async (input) => {
			// Return the input as-is if it is null or undefined
			if (!input) return input;

			// Encode the input string into a Uint8Array using UTF-8 encoding
			const encoder = new TextEncoder();
			const data = encoder.encode(input);

			// Calculate the SHA-256 hash as an ArrayBuffer
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);

			// Convert the ArrayBuffer to a hexadecimal string
			return Array.from(new Uint8Array(hashBuffer)) // Create an array from the hash bytes
				.map(byte => byte.toString(16).padStart(2, '0')) // Convert each byte to a two-character hex string
				.join(''); // Join all hex strings into a single result
		},
		/**
		 * Creates and initializes a new vector layer with specified features and style.
		 *
		 * This function creates a new vector layer using OpenLayers' `ol.layer.Vector`. The layer is populated
		 * with features from a provided feature collection and styled using a generic style function.
		 * The layer is also set to not be displayed in the layer switcher.
		 *
		 * @returns {void} This function does not return anything.
		 */
		createVectorLayer: () => {
			vectorLayer = new ol.layer.Vector({
				source: new ol.source.Vector({ features: featureCollection }), // Set the features in the vector source
				style: utilities.genericStyleFunction(colors.normal), // Apply a style function to the layer
			});
			vectorLayer.set('displayInLayerSwitcher', false); // Prevent the layer from appearing in the layer switcher
		},
		/**
		 * Generates a style for a vector feature with a circle marker and custom color.
		 *
		 * This function creates a style object for a vector feature using OpenLayers' `ol.style.Style`. 
		 * The style includes a circle marker with a fill and stroke, both of which use the specified color.
		 * It also applies a semi-transparent fill to the feature and a stroke with a defined color and width.
		 *
		 * @param {string} color - The color to apply to the style, in hexadecimal format (e.g., '#FF5733').
		 * @returns {Array<ol.style.Style>} - An array containing an OpenLayers style for the feature.
		 */
		genericStyleFunction: (color) => [
			new ol.style.Style({
				image: new ol.style.Circle({
					fill: new ol.style.Fill({ color: utilities.hexToRgbA(color) }), // Apply the fill color (converted to RGBA)
					stroke: new ol.style.Stroke({ color, width: 2 }), // Apply stroke color and width
					radius: 5, // Set the radius of the circle marker
				}),
				fill: new ol.style.Fill({ color: utilities.hexToRgbA(color, '0.3') }), // Apply a semi-transparent fill for the feature
				stroke: new ol.style.Stroke({ color, width: 2 }), // Apply stroke color and width to the feature
			}),
		],
		/**
		 * Generates a style function for vector features based on their geometry type and a specified color.
		 *
		 * This function returns a style for vector features (Point, LineString, Polygon) depending on the
		 * geometry type of the feature. The style includes custom stroke, fill, and shape properties. 
		 * The color of the style is customizable. If no color is provided, a default color is used.
		 *
		 * @param {string} color - The color to apply to the style, in hexadecimal format (e.g., '#FF5733').
		 * @returns {Function} - A function that returns the appropriate style for a feature based on its geometry type.
		 *                        The returned function accepts a feature and returns an array of styles.
		 */
		drawStyleFunction: (color) => {
			return function (feature) {
				var geometry = feature.getGeometry();
				color = color || colors.normal; // Default color if no color is provided

				if (geometry.getType() === 'LineString') {
					var styles = [
						new ol.style.Style({
							stroke: new ol.style.Stroke({
								color: utilities.hexToRgbA(color, '1'),
								width: 3
							})
						})
					];
					return styles;
				}

				if (geometry.getType() === 'Point') {
					var styles = [
						new ol.style.Style({
							image: new ol.style.RegularShape({
								fill: new ol.style.Fill({ color: colors.create }),
								stroke: new ol.style.Stroke({ color: color, width: 2 }),
								points: 4, // Square shape
								radius: 10, // Size of the shape
								radius2: 2, // Inner radius (smaller)
								angle: 0, // No rotation
							}),
						})
					];
					return styles;
				}

				if (geometry.getType() === 'Polygon') {
					var styles = [
						new ol.style.Style({
							stroke: new ol.style.Stroke({
								color: utilities.hexToRgbA(color, 0),
								width: 3
							}),
							fill: new ol.style.Fill({
								color: utilities.hexToRgbA(color, '0.3')
							})
						})
					];
					return styles;
				}

				return false; // Return false if geometry type is not recognized
			};
		},
		/**
		 * Restores the default border and background colors for the textarea element.
		 *
		 * This function resets the border color and background color of the textarea to their default values.
		 * It removes any custom styling applied to these properties, allowing the browser's default styling to take effect.
		 *
		 * @returns {void} This function does not return any value.
		 */
		restoreDefaultColors: function () {
			textarea.style.borderColor = ""; // Reset border color to default
			textarea.style.backgroundColor = ""; // Reset background color to default
		},
		/**
		 * Fetches the public IP address of the client using the ipify API.
		 *
		 * This asynchronous function makes a request to the ipify API to retrieve the client's public IP address.
		 * If the request is successful, it returns the IP address. If there is an error (e.g., network failure),
		 * it logs the error and returns a fallback message.
		 *
		 * @returns {Promise<string>} A promise that resolves to the public IP address as a string, or a fallback
		 *                            message if an error occurs during the fetch operation.
		 */
		getIP: async function () {
			try {
				// Using ipify.org as an example API to fetch the public IP address
				const response = await fetch('https://api.ipify.org?format=json');

				if (!response.ok) {
					throw new Error('Failed to fetch IP address');
				}

				const data = await response.json();
				return data.ip;
			} catch (error) {
				console.error('Error fetching IP:', error); // Log error to the console
				return 'Unable to retrieve IP address'; // Return fallback message on error
			}
		},
		/**
		 * Retrieves the user's current geographical location (latitude and longitude).
		 *
		 * This asynchronous function checks if geolocation is available in the user's browser. If available,
		 * it retrieves the user's current position using the `navigator.geolocation` API. If successful, it resolves
		 * with an object containing the latitude and longitude (rounded to 4 decimal places). If there is an error,
		 * it rejects with an appropriate error message.
		 *
		 * @returns {Promise<Object>} A promise that resolves with an object containing `latitude` and `longitude` properties
		 *                            (both rounded to 4 decimal places), or rejects with an error message if geolocation fails.
		 */
		getLocation: async function () {
			return new Promise((resolve, reject) => {
				// Check if geolocation is available
				if (!navigator.geolocation) {
					reject('Geolocation is not supported by your browser');
					return;
				}

				// Handle errors related to geolocation
				function handleError(error) {
					switch (error.code) {
						case error.PERMISSION_DENIED:
							reject('User denied the request for Geolocation');
							break;
						case error.POSITION_UNAVAILABLE:
							reject('Location information is unavailable');
							break;
						case error.TIMEOUT:
							reject('The request to get user location timed out');
							break;
						case error.UNKNOWN_ERROR:
							reject('An unknown error occurred while retrieving coordinates');
							break;
					}
					reject('Error getting location');
				}

				// Get current position
				navigator.geolocation.getCurrentPosition(
					(position) => {
						resolve({
							latitude: position.coords.latitude.toFixed(4),  // Round latitude to 4 decimal places
							longitude: position.coords.longitude.toFixed(4), // Round longitude to 4 decimal places
						});
					},
					handleError // Handle geolocation error
				);
			});
		},
		/**
		 * Captures a screenshot of the map element and appends it as an image to the body of the document.
		 *
		 * This function uses the `domtoimage` library to generate a PNG image of the map element (identified by the "map" ID).
		 * The image is created with the current dimensions of the map. If the screenshot is successfully created, it is
		 * appended to the document body as an image. If an error occurs during the process, it logs the error to the console.
		 *
		 * @param {Object} feature - The feature associated with the map (currently unused, but could be extended for specific use cases).
		 * @returns {void} This function does not return any value.
		 */
		imageCanvas: function (feature) {
			// Get the map element and its dimensions
			const map = document.getElementById("map");
			const width = map.offsetWidth;
			const height = map.offsetHeight;

			// Use domtoimage to capture a PNG image of the map
			domtoimage.toPng(map, {
				"width": width,
				"height": height
			})
				.then(function (dataUrl) {
					// Create an image element and set its source to the data URL
					var img = new Image();
					img.src = dataUrl;

					// Append the image to the body of the document
					document.body.appendChild(img);
				})
				.catch(function (error) {
					// Log any errors that occur during the image generation
					console.error('oops, something went wrong!', error);
				});
		}

	};

	const featureUtilities = {
		/**
		 * Deselects the currently selected feature if any. 
		 * If `active` is false, the selection state is toggled.
		 * 
		 * @param {boolean} active - If true, the selection state remains active; if false, the selection state is toggled.
		 * @returns {void} This method does not return a value.
		 */
		deselectCurrentFeature: (active) => {
			const selectInteraction = mapControls.selectCtrl.getInteraction();
			let conditionSelection = selectInteraction.getActive(); // Get the current selection state

			// Toggle the selection state if active is false
			if (!active) {
				conditionSelection = !conditionSelection;
			}

			const selectedFeatures = selectInteraction.getFeatures(); // Get the collection of selected features

			// If selection is active and features are selected
			if (conditionSelection && selectedFeatures.getArray().length > 0) {
				const activeFeature = selectedFeatures.item(0); // Get the first selected feature
				selectInteraction.dispatchEvent({
					type: 'select',
					selected: [],
					deselected: [activeFeature] // Deselect the feature
				});

				selectedFeatures.remove(activeFeature); // Remove the active feature from the selection
			}
		},
		/**
		 * Creates a MultiPolygon geometry from all features in the vector layer and writes its WKT 
		 * representation to the textarea.
		 * 
		 * This method retrieves the features from the vector layer, filters for geometries of type 
		 * Polygon or MultiPolygon, and combines them into a MultiPolygon. It then transforms the 
		 * geometry from Mercator to Geodetic projection and writes the resulting WKT string to the 
		 * textarea input.
		 * 
		 * @returns {void} This method does not return a value. It modifies the textarea input value.
		 */
		createFromAllFeatures: () => {
			const multi = featureUtilities.featuresToMultiPolygon(); // Get MultiPolygon geometry from all features
			if (multi) {
				const geo = multi.getGeometry().transform(projections.mercator, projections.geodetic); // Transform the geometry to Geodetic
				textarea.value = format.writeGeometry(geo); // Write the WKT representation to textarea
			} else {
				console.warn('No valid polygons or multipolygons found to create a MultiPolygon.');
			}
		},
		/**
		 * Centers and zooms the map view to fit the provided feature's geometry.
		 * 
		 * This function calculates the extent of the feature's geometry, determines its center point, 
		 * and updates the map view to center on that point. It also adjusts the map's zoom level 
		 * to fit the entire extent of the feature within the map's viewport with optional padding.
		 * 
		 * @param {ol.Feature} feature - The OpenLayers feature to center the map on.
		 * @returns {void} This method does not return any value. It modifies the map view directly.
		 */
		centerOnFeature: (feature) => {
			if (!feature) {
				console.error('Feature is required to center the map.');
				return;
			}

			const geometry = feature.getGeometry();
			const extent = geometry.getExtent(); // Get the geometry extent (bounding box)
			const center = ol.extent.getCenter(extent); // Get the center of the extent

			// Set the center of the map view to the calculated center
			map.getView().setCenter(center);

			// Fit the map view to the extent, with padding around the feature
			map.getView().fit(extent, { size: map.getSize(), padding: [50, 50, 50, 50] });
		},
		/**
		 * Centers and zooms the map view to fit all features within the specified vector layer's extent.
		 * 
		 * This function calculates the extent of all features within the provided vector layer's source,
		 * and adjusts the map view to center on that extent. It also modifies the zoom level to fit all 
		 * features within the map's viewport, with optional padding around the features.
		 * 
		 * @param {ol.layer.Vector} vector - The OpenLayers vector layer whose features will be centered.
		 * @returns {void} This method does not return any value. It modifies the map view directly.
		 */
		centerOnVector: (vector) => {
			// Check if there are any features in the vector source before proceeding
			if (mapUtilities.getFeatureCount() > 0) {
				const source = vector.getSource(); // Get the source of the vector layer

				// Calculate the extent (bounding box) of all features in the source
				const extent = source.getExtent();

				// Fit the map view to the calculated extent, with optional padding around the features
				map.getView().fit(extent, {
					size: map.getSize(), // Use the current map size for the best fit
					padding: [50, 50, 50, 50], // Optional padding around the extent
				});
			}
		},
		/**
		 * Converts all Polygon and MultiPolygon features in the vector layer to a MultiPolygon feature.
		 * 
		 * This function filters all features of type `Polygon` and `MultiPolygon` from the vector layer's source.
		 * It combines them into a single `MultiPolygon` feature. If there is only one polygon, it returns a 
		 * single `Polygon` feature. The function transforms the geometries to ensure they are in the correct 
		 * format before returning the final result.
		 * 
		 * @returns {ol.Feature|null} A MultiPolygon feature containing all filtered polygons, or null if no polygons are found.
		 */
		featuresToMultiPolygon: () => {
			// Get all features from the vector layer source
			const features = vectorLayer.getSource().getFeatures();

			// Filter for features of type 'Polygon' or 'MultiPolygon'
			const polygons = features.filter((f) =>
				['Polygon', 'MultiPolygon'].includes(f.getGeometry().getType())
			);

			// If no polygons were found, return null
			if (polygons.length === 0) return null;

			// Extract geometries from the filtered polygons
			const geometries = polygons.map((f) => f.getGeometry());

			// If only one polygon is found, return it as a Polygon feature
			if (geometries.length === 1) {
				return new ol.Feature(
					new ol.geom.Polygon(geometries[0].getCoordinates())
				);
			}

			// Otherwise, combine the geometries into a MultiPolygon and return
			return new ol.Feature(
				new ol.geom.MultiPolygon(
					geometries.map((g) => g.getCoordinates())  // Flatten all coordinates into a MultiPolygon
				)
			);
		},
		/**
		 * Removes the current vector layer (if it exists), creates a new vector layer, 
		 * and then adds it to the map.
		 * 
		 * This function handles the process of clearing any existing vector layer and 
		 * replacing it with a newly created vector layer. It ensures that the map displays
		 * the most up-to-date features. If the vector layer creation fails, an error is logged.
		 * 
		 * @async
		 * @returns {Promise<void>} A promise that resolves once the vector layer is added to the map.
		 */
		addFeatures: async () => {
			try {
				// If a vector layer exists, remove it from the map
				if (vectorLayer) {
					map.removeLayer(vectorLayer);
				}

				// Create a new vector layer and add it to the map
				utilities.createVectorLayer();

				// If vectorLayer exists after creation, add it to the map
				if (vectorLayer) {
					map.addLayer(vectorLayer);
				} else {
					// Log error if vector layer creation fails
					console.error("Failed to create the 'vector' layer. Please check the createVector function.");
				}
			} catch (error) {
				// Log any unexpected errors that may occur during the process
				console.error("Error while adding features to the map:", error);
			}
		},
		/**
		 * Adds a new feature to the collection from a provided WKT (Well-Known Text) string.
		 * 
		 * This function attempts to read the WKT string, transform the geometry coordinates
		 * from geodetic to mercator, and then adds the feature to the collection if valid.
		 * If the WKT string is empty or invalid, it highlights the textarea and does not add
		 * the feature to the collection.
		 * 
		 * @param {string} id - The unique identifier for the feature to be added.
		 * @param {string} [wkt] - The Well-Known Text (WKT) string representing the feature geometry.
		 *                            If not provided, the function will use the value from the textarea.
		 * 
		 * @returns {void}
		 */
		addToFeatures: function (id, wkt) {
			let newFeature;
			const wktString = wkt || textarea.value;

			// Check if WKT string is empty
			if (wktString === "") {
				textarea.style.borderColor = "red";
				textarea.style.backgroundColor = "#F7E8F3";
				return; // Early exit if WKT string is empty
			}

			// Attempt to read the WKT string and create a feature
			try {
				newFeature = format.readFeature(wktString);
			} catch (err) {
				console.error('Error reading WKT:', err);
				textarea.style.borderColor = "red";
				textarea.style.backgroundColor = "#F7E8F3";
				return; // Exit if there was an error parsing WKT
			}

			// If no feature is created, indicate an error
			if (!newFeature) {
				textarea.style.borderColor = "red";
				textarea.style.backgroundColor = "#F7E8F3";
				return;
			}

			// Transform the feature geometry from geodetic to mercator projection
			newFeature.getGeometry().transform(projections.geodetic, projections.mercator);

			// Set the feature's unique ID and add it to the feature collection
			newFeature.setId(id);
			featureCollection.push(newFeature);

			// Reset the textarea style on successful feature addition
			textarea.style.borderColor = "";
			textarea.style.backgroundColor = "";
		}
	};

	const mapUtilities = {
		toggleLayers: function () {
			const osmVisible = osmLayer.getVisible();
			osmLayer.setVisible(!osmVisible); // Toggle visibility
			arcgisLayer.setVisible(osmVisible); // Opposite visibility
			mapControls.layerChangeBtn.setHtml(utilities.layerChangeBtnHtml());
		},
		reviewLayout: async function (center) {
			if (mapUtilities.getFeatureCount() > 0) {
				main.classList.remove("nowkt");
				featureUtilities.createFromAllFeatures();
			}
			else {
				main.classList.add("nowkt");
				mapControls.selectBar.setVisible(false);
			}
			if (center) {
				await mapUtilities.center().then(function () {
					map.updateSize();
				});
			}
			else {
				map.updateSize();
			}
		},
		center: async function () {
			if (!main.classList.contains("nowkt")) {
				const extent = ol.extent.createEmpty();
				featureCollection.forEach(feature => ol.extent.extend(extent, feature.getGeometry().getExtent()));
				map.getView().fit(extent, {
					size: map.getSize(),
					padding: [50, 50, 50, 50],
				});
			} else {
				map.getView().setCenter(defaultCenter);
				map.getView().setZoom(16);
			}
		},
		getFeatureCount: function () {
			var vectorLayer = map.getLayers().getArray().find(layer => layer instanceof ol.layer.Vector);
			if (!vectorLayer) {
				console.error('No vector layer found on the map.');
				return 0;
			}
			var features = vectorLayer.getSource().getFeatures();
			return features.length;
		},
		loadWKTs: async function (readcb) {
			var self = this;

			wktUtilities.load();

			var wkts = wktUtilities.get();

			textarea.focus();

			var wkt = "";
			if (readcb)
				wkt = await wktUtilities.readClipboard();

			await utilities.generateChecksum(wkt).then(async function (checksum) {
				if (wkts == null || wkts == undefined)
					wkts = [];

				var exists = false;
				var idx = 0;

				if (wkts.length > 0) {
					wkts.forEach(item => {
						if (checksum !== "" && item.id === checksum)
							exists = true;
						featureUtilities.addToFeatures(item.id, item.wkt);
						idx = idx + 1;
					});
				}

				if (wkt != "" && !exists) {
					wkts.push({ id: checksum, wkt: wkt });
					featureUtilities.addToFeatures(checksum, wkt);
					idx = idx + 1;
				}

				map.set("wkts", wkts);

				wktUtilities.save()

				await featureUtilities.addFeatures().then(async function () {
					self.reviewLayout(true);
				});
			});
			// });
		},
	};

	var wktUtilities = {
		load: function () {
			var wkts = localStorage.getItem(lfkey) || "[]";
			map.set("wkts", JSON.parse(wkts));
		},
		remove: function (id) {
			var wkts = map.get("wkts");
			wkts = wkts.filter(function (item) {
				return item.id !== id;
			});
			map.set("wkts", wkts);
			this.save();
		},
		save: function () {
			localStorage.setItem(lfkey, JSON.stringify(this.get()));
		},
		add: async function (wkt) {
			var self = this;
			await utilities.generateChecksum(wkt).then(function (checksum) {
				var exists = false;
				var wkts = map.get("wkts");
				if (wkts.length > 0) {
					wkts.forEach(item => {
						if (checksum !== "" && item.id === checksum)
							exists = true;
					});
				}
				if (wkt != "" && !exists) {
					wkts.push({ id: checksum, wkt: wkt });
				}
				map.set("wkts", wkts);
				self.save();
			});

		},
		get: function () {
			return map.get("wkts");
		},
		update: function (id, wkt) {
			var wkts = map.get("wkts");
			if (wkts.length > 0) {
				wkts.forEach(function (item) {
					if (item.id === id)
						item.wkt = wkt;
				});
			}
			map.set("wkts", wkts);
			this.save();
		},
		readClipboard: async function () {
			var returnVal = "";
			try {
				textarea.focus();
				const permission = await navigator.permissions.query({ name: 'clipboard-read' });
				if (permission.state === 'denied') {
					throw new Error('Not allowed to read clipboard.');
				}
				const text = await navigator.clipboard.readText();
				if (text.indexOf('POLYGON') !== -1) {
					returnVal = text;
					navigator.clipboard.writeText("");
				}
			} catch (error) {
				console.error('readClipboard:', error.message);
			}
			return returnVal;
		},
		paste: async function (ele) {
			await wktUtilities.add(ele.value).then(async function (result) {
				await mapUtilities.loadWKTs();
			});
		},
	}

	function setupMap() {

		main = document.querySelector(".maincontainer");
		textarea = document.querySelector("#wktdefault textarea");

		format = new ol.format.WKT();
		featureCollection = new ol.Collection();
		defaultCenter = utilities.transformCoordinates(
			[mapDefaults.longitude, mapDefaults.latitude],
			projections.geodetic,
			projections.mercator
		);

		// Initialize map and layers
		utilities.createVectorLayer();
		map = new ol.Map({
			layers: [
				osmLayer, arcgisLayer,
				vectorLayer,
			],
			target: 'map',
			controls: ol.control.defaults.defaults({ attribution: false }),
			view: new ol.View({ center: defaultCenter, zoom: mapDefaults.zoom, maxZoom: 19 }),
		});

		// Add controls and interactions
		initializeMapControls();
	}

	function initializeMapControls() {

		map.addInteraction(new ol.interaction.DragPan({
			condition: function (event) {
				return true;
			}
		}));

		map.addInteraction(new ol.interaction.MouseWheelZoom({
			condition: function (event) {
				return true;
			}
		}));

		// Main control bar
		var mainBar = new ol.control.Bar({ className: 'mainbar' });
		map.addControl(mainBar);

		mapControls.mainBar = mainBar;

		// Edit control bar 
		var editBar = new ol.control.Bar({
			className: 'editbar',
			toggleOne: true,	// one control active at the same time
			group: false			// group controls together
		});
		mainBar.addControl(editBar);

		mapControls.editBar = editBar;

		// Add selection tool:
		//  1- a toggle control with a select interaction
		//  2- an option bar to delete / get information on the selected feature
		var selectBar = new ol.control.Bar();

		mapControls.selectBar = selectBar;

		var deleteBtn = new ol.control.Button({
			html: '<i class="fa fa-times fa-lg"></i>',
			name: "Delete",
			title: "Delete",
			handleClick: function () {
				var features = selectCtrl.getInteraction().getFeatures();
				if (!features.getLength())
					textarea.value = "Select an object first...";
				else {
					var feature = features.item(0);
					wktUtilities.remove(feature.getId());
					for (var i = 0, f; f = features.item(i); i++) {
						vectorLayer.getSource().removeFeature(f);
					}
					features.clear();
					mapUtilities.reviewLayout(false);
					mapControls.selectBar.setVisible(false);
				}
			}
		});

		mapControls.deleteBtn = deleteBtn;

		selectBar.addControl(deleteBtn);

		var infoBtn = new ol.control.Button({
			html: '<i class="fa fa-info fa-lg"></i>',
			name: "Info",
			title: "Show informations",
			handleClick: function () {
				switch (selectCtrl.getInteraction().getFeatures().getLength()) {
					case 0:
						textarea.value = "Select an object first...";
						break;
					case 1:
						textarea.value = utilities.getFeatureWKT(selectCtrl.getInteraction().getFeatures().item(0));
						break;
				}
			}
		});

		mapControls.infoBtn = infoBtn;

		//selectBar.addControl(infoBtn);

		selectBar.setVisible(false);

		selectCtrl = new ol.control.Toggle({
			html: '<i class="fa-solid fa-arrow-pointer fa-lg"></i>',
			title: "Select",
			interaction: new ol.interaction.Select({ hitTolerance: 2, style: utilities.genericStyleFunction(colors.edit) }),
			bar: selectBar,
			autoActivate: true,
			active: true
		});

		mapControls.selectCtrl = selectCtrl;

		editBar.addControl(selectCtrl);

		modifyInteraction = new ol.interaction.ModifyFeature({
			features: selectCtrl.getInteraction().getFeatures(),
			style: utilities.genericStyleFunction(colors.snap),
			insertVertexCondition: function () {
				return true;
			},
		})

		mapControls.modifyInteraction = modifyInteraction;

		map.addInteraction(modifyInteraction);

		select = selectCtrl.getInteraction().on('select', function (evt) {
			utilities.restoreDefaultColors();
			if (evt.deselected.length > 0) {
				evt.deselected.forEach(function (feature) {
					textarea.value = utilities.getFeatureWKT(feature);
					wktUtilities.update(feature.getId(), textarea.value);
					featureUtilities.createFromAllFeatures();
				});
				selectBar.setVisible(false);
			}
			if (evt.selected.length > 0) {
				evt.selected.forEach(function (feature) {
					textarea.value = utilities.getFeatureWKT(feature);
				});
				selectBar.setVisible(true);
			}
		});

		// Activate with select
		modifyInteraction.setActive(selectCtrl.getInteraction().getActive())
		selectCtrl.getInteraction().on('change:active', function (evt) {
			modifyInteraction.setActive(selectCtrl.getInteraction().getActive())
		}.bind(editBar));

		drawCtrl = new ol.control.Toggle({
			html: '<i class="fa-solid fa-draw-polygon fa-lg"></i>',
			title: 'Polygon',
			interaction: new ol.interaction.Draw({
				type: 'Polygon',
				source: vectorLayer.getSource(),
				style: utilities.drawStyleFunction(colors.create),
			})
		});

		mapControls.drawCtrl = drawCtrl;

		editBar.addControl(drawCtrl);

		draw = drawCtrl.getInteraction().on('drawend', async function (evt) {
			wkt = utilities.getFeatureWKT(evt.feature);
			await wktUtilities.add(wkt).then(function (result) {
				mapUtilities.reviewLayout(false);
				featureUtilities.centerOnFeature(evt.feature);
			});
		});

		drawCtrl.getInteraction().on('change:active', function (evt) {
			featureUtilities.deselectCurrentFeature(false);
		}.bind(editBar));

		// Undo redo interaction
		undoInteraction = new ol.interaction.UndoRedo();
		map.addInteraction(undoInteraction);

		mapControls.undoInteraction = undoInteraction;

		var undoBtn = new ol.control.Button({
			html: '<i class="fa-solid fa-rotate-left fa-lg"></i>',
			title: 'Undo...',
			handleClick: function () {
				undoInteraction.undo();
			}
		});

		editBar.addControl(undoBtn);

		mapControls.undoBtn = undoBtn;

		redoBtn = new ol.control.Button({
			html: '<i class="fa-solid fa-rotate-right fa-lg"></i>',
			title: 'Redo...',
			handleClick: function () {
				undoInteraction.redo();
			}
		});

		editBar.addControl(redoBtn);

		mapControls.redoBtn = redoBtn;

		/* undo/redo custom */
		var style;
		// Define undo redo for the style
		undoInteraction.define(
			'style',
			// undo function: set previous style
			function (s) {
				style = s.before;
				vectorLayer.changed();
			},
			// redo function: reset the style
			function (s) {
				style = s.after;
				vectorLayer.changed();
			}
		);

		var locationBar = new ol.control.Bar({
			className: 'locationbar',
			toggleOne: false,	// one control active at the same time
			group: false			// group controls together
		});
		mainBar.addControl(locationBar);
		mapControls.locationBar = locationBar;

		var locationBtn = new ol.control.Button({
			html: '<i class="fa-solid fa-location-crosshairs fa-lg"></i>',
			title: 'Center in my location...',
			handleClick: function () {
				if (typeof userLocation === 'undefined') {
					utilities.getLocation().then(location => {
						map.getView().setCenter(ol.proj.transform([location.longitude, location.latitude], projections.geodetic, projections.mercator));
					});
				} else {
					map.getView().setCenter(userLocation);
				}
				map.getView().setZoom(map.getView().getZoom());
				mapControls.selectCtrl.setActive(true);
			}
		});
		locationBar.addControl(locationBtn);

		mapControls.locationBtn = locationBtn;

		var centerObjectsBtn = new ol.control.Button({
			html: '<i class="fa-solid fa-arrows-to-dot fa-lg"></i>',
			title: 'Center on map objects...',
			handleClick: function () {
				featureUtilities.centerOnVector();
				mapControls.selectCtrl.setActive(true);
			}
		});
		locationBar.addControl(centerObjectsBtn);

		mapControls.centerObjectsBtn = centerObjectsBtn;

		map.addInteraction(new ol.interaction.Snap({
			source: vectorLayer.getSource()
		}));

		var layerBar = new ol.control.Bar({
			className: 'layerbar',
			toggleOne: false,	// one control active at the same time
			group: false,		// group controls together
		});
		map.addControl(layerBar);
		mapControls.layerBar = layerBar;

		var layerChangeBtn = new ol.control.Button({
			html: utilities.layerChangeBtnHtml(),
			title: 'Change layer...',
			handleClick: mapUtilities.toggleLayers
		});
		layerBar.addControl(layerChangeBtn);

		mapControls.layerChangeBtn = layerChangeBtn;

		// var attrBar = new ol.control.Bar({
		// 	className: 'attrbar',
		// 	toggleOne: false,	// one control active at the same time
		// 	group: false,		// group controls together
		// });
		// map.addControl(attrBar);
		// mapControls.attrBar = attrBar;

		// var attrToggleBtn = new ol.control.Button({
		// 	html: '<i class="fa-solid fa-circle-info fa-lg"></i>',
		// 	title: 'Show Attribution ...',
		// 	handleClick: () => {
		// 		let collaped = mapControls.attributionControl.getCollapsed();
		// 		mapControls.attributionControl.setCollapsed(!collaped);
		// 	}
		// });
		// attrBar.addControl(attrToggleBtn);

		// mapControls.attrToggleBtn = attrToggleBtn;

		const attributionControl = new ol.control.Attribution({
			collapsible: true
		});

		console.log(attributionControl);

		attributionControl.element.innerHTML = '<i class="fa-solid fa-circle-info fa-lg"></i>';

		map.addControl(attributionControl);

		mapControls.attributionControl = attributionControl;

		document.addEventListener('keydown', function (evt) {
			switch (evt.key) {
				case 'Escape':
					if (!mapControls.selectCtrl.getActive()) {
						mapControls.selectCtrl.setActive(true);
					} else {
						featureUtilities.deselectCurrentFeature(true);
					}
					break;
				case 'Delete':
					if (mapControls.selectCtrl.getActive()) {
						var selectInteraction = mapControls.selectCtrl.getInteraction();
						if (mapControls.selectCtrl.getActive()) {
							selectedFeatures = selectInteraction.getFeatures(); // Get the selected features collection
							if (selectedFeatures.getArray().length > 0) {
								mapControls.deleteBtn.getButtonElement().click();
							}
						}
					}
					break;
				case 'z':
					if (evt.ctrlKey) {
						mapControls.undoInteraction.undo();
					}
					break;
				case 'y':
					if (evt.ctrlKey) {
						mapControls.undoInteraction.redo();
					}
					break;
			}
		}, false);

	}

	return {

		init: function () {

			utilities.getLocation().then(location => {
				console.log("location", location);

				//mapDefaults.longitude = location.longitude;
				//mapDefaults.latitude = location.latitude;
				userLocation = ol.proj.transform([location.longitude, location.latitude], projections.geodetic, projections.mercator);
				defaultCenter = userLocation;

				setupMap();

				mapUtilities.loadWKTs(true);
			});

			utilities.getIP().then(ip => {
				if (typeof ip === 'string' && ip.startsWith('http')) {
					navigator.geolocation.getCurrentPosition(position => {
						latitude = position.coords.latitude;
						longitude = position.coords.longitude;
						console.log(`Estimated IP based on location: ${latitude}, ${longitude}`);
					});
				} else {
					console.log(`Retrieved IP address: ${ip}`);
				}
			});

		}
	};

}());