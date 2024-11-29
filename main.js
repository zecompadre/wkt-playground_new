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

	const styleFunction = (feature, color) => {
		var geometry = feature.getGeometry();
		color = color || colors.normal;

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
						points: 4,
						radius: 10,
						radius2: 2,
						angle: 0,
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
						color: utilities.hexToRgbA('#ffffff', '0.5')
					})
				})
			];
			return styles;
		}
		return false;
	};

	const mapDefaults = {
		latitude: 39.6945,
		longitude: -8.1234,
		zoom: 6,
	};

	let map, vectorLayer, format, defaultCenter, userLocation, featureCollection, main, textarea, modifyInteraction, undoInteraction;

	let lfkey = "zecompadre-wkt";

	let mapControls = {};

	// let crosshair = new ol.style.Style({
	//     image: new ol.style.Icon({
	//         src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Crosshairs_Red.svg/100px-Crosshairs_Red.svg.png',
	//         size: [100, 100],
	//         opacity: 1,
	//         scale: 0.4
	//     })

	const utilities = {
		transformCoordinates: (coords, from, to) => ol.proj.transform(coords, from, to),
		hexToRgbA: (hex, opacity) => {
			opacity = opacity || '0.2';
			const bigint = parseInt(hex.replace(/^#/, ''), 16);
			const r = (bigint >> 16) & 255;
			const g = (bigint >> 8) & 255;
			const b = bigint & 255;
			return `rgba(${r}, ${g}, ${b}, ${opacity})`;
		},
		getFeatureWKT: (feature) => {
			if (!feature)
				return "";
			const geom = feature.getGeometry().clone();
			return format.writeGeometry(geom.transform(projections.mercator, projections.geodetic));
		},
		generateChecksum: async (input) => {
			if (!input) return input;
			const encoder = new TextEncoder();
			const data = encoder.encode(input);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			return Array.from(new Uint8Array(hashBuffer))
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
		},
		createVectorLayer: () => {
			vectorLayer = new ol.layer.Vector({
				source: new ol.source.Vector({ features: featureCollection }),
				style: utilities.createStyles(colors.normal),
			});
		},
		createStyles: (color) => [
			new ol.style.Style({
				image: new ol.style.Circle({
					fill: new ol.style.Fill({ color: utilities.hexToRgbA(color) }),
					stroke: new ol.style.Stroke({ color, width: 2 }),
					radius: 5,
				}),
				fill: new ol.style.Fill({ color: utilities.hexToRgbA(color) }),
				stroke: new ol.style.Stroke({ color, width: 2 }),
			}),
		],
		restoreDefaultColors: function () {
			textarea.style.borderColor = "";
			textarea.style.backgroundColor = "";
		},
		getIP: async function () {
			try {
				// Using ipify.org as an example API
				const response = await fetch('https://api.ipify.org?format=json');

				if (!response.ok) {
					throw new Error('Failed to fetch IP address');
				}

				const data = await response.json();
				return data.ip;
			} catch (error) {
				console.error('Error fetching IP:', error);
				return 'Unable to retrieve IP address';
			}
		},
		getLocation: async function () {
			return new Promise((resolve, reject) => {
				// Check if geolocation is available
				if (!navigator.geolocation) {
					reject('Geolocation is not supported by your browser');
					return;
				}

				// Handle errors
				function handleError(error) {
					switch (error.code) {
						case error.PERMISSION_DENIED:
							reject('User denied the request for Geolocation');
						case error.POSITION_UNAVAILABLE:
							reject('Location information is unavailable');
						case error.TIMEOUT:
							reject('The request to get user location timed out');
						case error.UNKNOWN_ERROR:
							reject('An unknown error occurred while retrieving coordinates');
					}
					reject('Error getting location');
				}

				// Get current position
				navigator.geolocation.getCurrentPosition(
					(position) => {
						resolve({ latitude: position.coords.latitude.toFixed(4), longitude: position.coords.longitude.toFixed(4) });
					},
					handleError
				);
			});
		},
		imageCanvas: function (feature) {
			const map = document.getElementById("map");
			const width = map.offsetWidth;
			const height = map.offsetHeight;
			domtoimage.toPng(map, {
				"width": width,
				"height": height
			}).then(function (dataUrl) {
				var img = new Image();
				img.src = dataUrl;
				document.body.appendChild(img);
			}).catch(function (error) {
				console.error('oops, something went wrong!', error);
			});
		}
	};

	const featureUtilities = {
		deselectCurrentFeature: function (active) {
			var selectInteraction = mapControls.selectCtrl.getInteraction();
			var conditionSelection = selectInteraction.getActive();
			if (!active)
				conditionSelection = !conditionSelection;
			const selectedFeatures = selectInteraction.getFeatures(); // Get the selected features collection
			if (conditionSelection && selectedFeatures.getArray().length > 0) {
				var activeFeature = selectedFeatures.item(0);
				selectInteraction.dispatchEvent({ type: 'select', selected: [], deselected: [activeFeature] });
				selectedFeatures.remove(activeFeature);
			}
		},
		createFromAllFeatures: function () {
			var multi = this.featuresToMultiPolygon();
			var geo = multi.getGeometry().transform(projections.mercator, projections.geodetic);
			textarea.value = format.writeGeometry(geo);
		},
		centerOnFeature: (feature) => {
			const extent = feature.getGeometry().getExtent();
			const center = ol.extent.getCenter(extent);
			map.getView().setCenter(center);
			map.getView().fit(extent, { size: map.getSize(), padding: [50, 50, 50, 50] });
		},
		centerOnVector: function (vector) {
			if (mapUtilities.getFeatureCount() > 0) {
				const source = vectorLayer.getSource(); // Replace 'layer' with your vector layer variable

				// Calculate the extent of all features in the source
				const extent = source.getExtent();

				// Fit the map view to the extent
				map.getView().fit(extent, {
					size: map.getSize(),  // Use the map size to determine the best fit
					padding: [50, 50, 50, 50], // Add some padding (optional)
				});
			}
		},
		featuresToMultiPolygon: () => {
			const features = vectorLayer.getSource().getFeatures();
			const polygons = features.filter((f) =>
				['Polygon', 'MultiPolygon'].includes(f.getGeometry().getType())
			);

			if (!polygons.length) return null;

			const geometries = polygons.map((f) => f.getGeometry());

			if (geometries.length === 1) {
				return new ol.Feature(
					new ol.geom.Polygon(geometries[0].getCoordinates())
				);
			}

			return new ol.Feature(
				new ol.geom.MultiPolygon(
					geometries.map((g) =>
						g.getType() === 'Polygon' ? g.getCoordinates() : g.getCoordinates()
					)
				)
			);
		},
		addFeatures: async function () {
			if (vectorLayer)
				map.removeLayer(vectorLayer); // Remove a camada existente
			utilities.createVectorLayer(); // Aguarda a criação da camada
			if (vectorLayer)
				map.addLayer(vectorLayer); // Adiciona a nova camada ao mapa
			else
				console.error("Falha ao criar a camada 'vector'. Verifique a função createVector.");
		},
		addToFeatures: function (id, wkt) {
			var new_feature;
			var wkt_string = wkt || textarea.value;
			if (wkt_string === "") {
				textarea.style.borderColor = "red";
				textarea.style.backgroundColor = "#F7E8F3";
				return;
			} else {
				try {
					new_feature = format.readFeature(wkt_string);
				} catch (err) {
					console.error('Error reading WKT:', err);
				}
			}
			if (!new_feature) {
				textarea.style.borderColor = "red";
				textarea.style.backgroundColor = "#F7E8F3";
				return;
			} else {
				new_feature.getGeometry().transform(projections.geodetic, projections.mercator);
				new_feature.setId(id);
				featureCollection.push(new_feature);
			}
		},
	};

	const mapUtilities = {
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
				new ol.layer.Tile({ source: new ol.source.OSM() }),
				vectorLayer,
			],
			target: 'map',
			view: new ol.View({ center: defaultCenter, zoom: mapDefaults.zoom }),
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
			interaction: new ol.interaction.Select({ hitTolerance: 2, style: utilities.createStyles(colors.edit) }),
			bar: selectBar,
			autoActivate: true,
			active: true
		});

		mapControls.selectCtrl = selectCtrl;

		editBar.addControl(selectCtrl);

		modifyInteraction = new ol.interaction.ModifyFeature({
			features: selectCtrl.getInteraction().getFeatures(),
			style: utilities.createStyles(colors.snap),
			insertVertexCondition: function () {
				return true;
			},
		})

		mapControls.modifyInteraction = modifyInteraction;

		map.addInteraction(modifyInteraction);

		select = selectCtrl.getInteraction().on('select', function (evt) {
			utilities.restoreDefaultColors();
			if (evt.deselected.length > 0) {
				console.log("deselected", evt)
				evt.deselected.forEach(function (feature) {
					textarea.value = utilities.getFeatureWKT(feature);
					wktUtilities.update(feature.getId(), textarea.value);
					featureUtilities.createFromAllFeatures();
				});
				selectBar.setVisible(false);
			}
			if (evt.selected.length > 0) {
				console.log("selected", evt)
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
				style: styleFunction.apply(this, [colors.create]),
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