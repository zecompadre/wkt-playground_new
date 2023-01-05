var raster;
var source;
var vector;
var map;
var features = new ol.Collection();
var format = new ol.format.WKT();
/*
var typeSelect;
var draw;
var multi;
var current_shape = 'polygon';
*/
var fill = new ol.style.Fill({
	color: 'rgba(0,91,170, 0.2)',
});
var stroke = new ol.style.Stroke({
	color: '#005baa',
	width: 2,
});
var styles = [
	new ol.style.Style({
		image: new ol.style.Circle({
			fill: fill,
			stroke: stroke,
			radius: 5,
		}),
		fill: fill,
		stroke: stroke,
	}),
];

function init() {

	$('div.btn-group button').on('click', function (event) {
		var id = event.target.id;
		button.button('toggle');
		button = $('#' + id).button('toggle');
		map.removeInteraction(interaction);

		switch (id) {
			case "point":
				interaction = new ol.interaction.Draw({
					type: 'Point',
					source: vector.getSource()
				});
				map.addInteraction(interaction);
				break;
			case "line":
				interaction = new ol.interaction.Draw({
					type: 'LineString',
					source: vector.getSource()
				});

				map.addInteraction(interaction);
				break;
			case "polygon":
				interaction = new ol.interaction.Draw({
					type: 'Polygon',
					source: vector.getSource()
				});
				map.addInteraction(interaction);
				break;
			case "modify":

				interaction = new ol.interaction.Modify({
					features: new ol.Collection(vector.getSource().getFeatures())
				});
				map.addInteraction(interaction);

				break;
			case "delete":
				interaction = new ol.interaction.Select({
					condition: ol.events.condition.click,
					layers: [vector]
				});
				map.addInteraction(interaction);

				interaction.on('select', function (event) {
					selectedFeature = event.selected[0];
					(selectedFeature) ? overlay.setPosition(selectedFeature.getGeometry().getExtent()) : overlay.setPosition(undefined);

				});
				break;
			case "draw":
				plotWKT();
				break;
			default:
				break;
		}
		var snap = new ol.interaction.Snap({
			source: vector.getSource()
		});
		map.addInteraction(snap);
	});

	createVector();

	features.on('add', updateWKY);
	features.on('remove', updateWKY);

	map = new ol.Map({
		layers: [
			new ol.layer.Tile({
				source: new ol.source.OSM()
			}),
			vector
		],
		target: 'map',
		view: new ol.View({
			center: [-11000000, 4600000],
			zoom: 4
		})
	});

	map.on('pointermove', function (e) {
		if (e.dragging) return;
		var
			pixel = map.getEventPixel(e.originalEvent),
			hit = map.hasFeatureAtPixel(pixel);
		map.getTargetElement().style.cursor = hit ? 'pointer' : '';
	});

	document.getElementById('js-remove').addEventListener('click', function () {
		vector.getSource().removeFeature(selectedFeature);
		overlay.setPosition(undefined);
		interaction.getFeatures().clear();
	});

	var remove_b = document.getElementById('js-overlay');
	var overlay = new ol.Overlay({
		element: remove_b
	});
	map.addOverlay(overlay);
	document.getElementById('js-overlay').style.display = 'block';
	var selectedFeature;
	var button = $('#pan').button('toggle');
	var interaction;

	$('#wktStringTextArea').on("click", function () {
		$(this).css({ borderColor: '', backgroundColor: '' });
	});

	$('#wktStringTextArea').on("change", function () {
		$("#draw").trigger("click");
	});

	plotWKT();
	changeUI();
	pasteWKT();
}

/**
 * Let user change the geometry type.
 * @param {Event} e Change event.
 */
function createVector() {
	vector = new ol.layer.Vector({
		source: new ol.source.Vector({
			features: features,
		}),
		style: styles,
	});
}

/**
 * Plot wkt string on map
 */
function plotWKT() {
	var new_feature;
	var wkt_string = $('#wktStringTextArea').val();
	if (wkt_string == '') {
		$('#wktStringTextArea').css({ borderColor: 'red', backgroundColor: '#F7E8F3' });
		return;
	} else {
		try {
			new_feature = format.readFeature(wkt_string);
		} catch (err) { }
	}
	if (!new_feature) {
		$('#wktStringTextArea').css({ borderColor: 'red', backgroundColor: '#F7E8F3' });
		return;
	} else {
		map.removeLayer(vector);
		features.clear();
		new_feature.getGeometry().transform('EPSG:4326', 'EPSG:3857');
		features.push(new_feature);
	}
	vector = new ol.layer.Vector({
		source: new ol.source.Vector({
			features: features,
		}),
		style: styles,
	});

	map.addLayer(vector);

	derived_feature = features.getArray()[0];
	extent = derived_feature.getGeometry().getExtent();
	minx = derived_feature.getGeometry().getExtent()[0];
	miny = derived_feature.getGeometry().getExtent()[1];
	maxx = derived_feature.getGeometry().getExtent()[2];
	maxy = derived_feature.getGeometry().getExtent()[3];
	centerx = (minx + maxx) / 2;
	centery = (miny + maxy) / 2;

	map.setView(
		new ol.View({
			center: [centerx, centery],
			zoom: 8,
		}),
	);

	map.getView().fit(extent, map.getSize());
}

function toEPSG4326(element, index, array) {
	element = element.getGeometry().transform('EPSG:3857', 'EPSG:4326');
}

function toEPSG3857(element, index, array) {
	element = element.getGeometry().transform('EPSG:4326', 'EPSG:3857');
}

function copyWKT() {
	var textarea = document.getElementById('wktStringTextArea');
	textarea.select();
	document.execCommand("copy");
}

async function pasteWKT() {
	try {
		const permission = await navigator.permissions.query({ name: 'clipboard-read' });
		if (permission.state === 'denied') {
			throw new Error('Not allowed to read clipboard.');
		}
		const text = await navigator.clipboard.readText();
		if (text.indexOf('POLYGON') !== -1) {
			document.getElementById('wktStringTextArea').value = text;
			plotWKT();
		}
	} catch (error) {
		console.error('pasteWKT:', error.message);
	}
}

function resizeText() {
	var doc = $(document).height();
	var bar = $('.navbar').outerHeight();
	var map = $('#map').outerHeight();
	var buttons = $('.btn-group.btn-group-md').outerHeight();
	var text = doc - (bar + map + buttons + 30);
	$('#wktStringTextArea').height(text);
}

function changeUI() {
	$("#wktStringTextArea").css({ fontSize: '0.75rem' });
	window.onresize = resizeText;
	resizeText();
}

function loadWKTfromURIFragment(fragment) {
	// remove first character from fragment as it contains '#'
	var wkt = window.location.hash.slice(1);
	document.getElementById('wktStringTextArea').value = decodeURI(wkt);
}

function updateWKY() {
	$("#wktStringTextArea").css({ borderColor: '', backgroundColor: '' });

	features.forEach(toEPSG4326);
	console.log(features.getArray());
	multi = features.getArray().map((f) => f.getGeometry().getCoordinates());

	document.getElementById('wktStringTextArea').value = format.writeFeatures(features.getArray(), {
		rightHanded: true,
	});
	features.forEach(toEPSG3857);
}

$(document).ready(init);