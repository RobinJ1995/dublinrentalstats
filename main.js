const Cheerio = require('cheerio');
const Request = require('request-promise');
const Promise = require('bluebird');
const Fs = require('fs');

const URL_RENT_CO = 'http://www.daft.ie/dublin/residential-property-for-rent/?s[sort_type]=a&s[sort_by]=price';
const URL_RENT_CI = 'http://www.daft.ie/dublin-city/residential-property-for-rent/?s[sort_by]=price&s[sort_type]=a&searchSource=rental';

const URL_SHARING_CO = 'http://www.daft.ie/dublin/rooms-to-share/?s%5Broom_type%5D=either&s%5Badvanced%5D=1&s%5Bgender%5D=on&s%5Bsort_by%5D=price&s%5Bsort_type%5D=a&searchSource=sharing';
const URL_SHARING_CI = 'http://www.daft.ie/dublin/rooms-to-share/dublin-city-centre/?s%5Broom_type%5D=either&s%5Badvanced%5D=1&s%5Bgender%5D=on&s%5Bsort_by%5D=price&s%5Bsort_type%5D=a&searchSource=sharing';

const SEL_PRICE = '#sr_content .price';
const SEL_NEXT_PAGE = '.paging .next_page a';

const WEEKS_IN_A_MONTH = 4.34524; // https://www.google.ie/search?q=weeks+in+a+month //
const STATS_FILE = 'stats.json';
const INDEX_DELAY = 1000;

const CONFIG_VERBOSE = !!process.env.VERBOSE;
const CONFIG_S3_BUCKET = process.env.S3_BUCKET;
const CONFIG_S3_ENDPOINT = process.env.S3_ENDPOINT;

const promises = [];

// Rent
promises.push(fetchAllPrices(URL_RENT_CO, SEL_PRICE));
promises.push(fetchAllPrices(URL_RENT_CI, SEL_PRICE));

// Sharing
promises.push(fetchAllPrices(URL_SHARING_CO, SEL_PRICE));
promises.push(fetchAllPrices(URL_SHARING_CI, SEL_PRICE));

Promise.all(promises).then(
([
	rentCo,
	rentCi,
	sharingCo,
	sharingCi,
]) => {
	
	const rentCoStats = {
		prices: rentCo,
		...performCalculations(rentCo),
	};
	const rentCiStats = {
		prices: rentCi,
		...performCalculations(rentCi),
	};
	const sharingCoStats = {
		prices: sharingCo,
		...performCalculations(sharingCo),
	};
	const sharingCiStats = {
		prices: sharingCi,
		...performCalculations(sharingCi),
	};
	
	console.log(`
########
# Rent #
########

Co. Dublin
##########
Lowest: €${formatNumber(rentCoStats.lowest)}
Highest: €${formatNumber(rentCoStats.highest)}

City Centre
###########
Lowest: €${formatNumber(rentCiStats.lowest)}
Highest: €${formatNumber(rentCiStats.highest)}

###########
# Sharing #
###########

Co. Dublin
##########
Lowest: €${formatNumber(sharingCoStats.lowest)}
Highest: €${formatNumber(sharingCoStats.highest)}

City Centre
###########
Lowest: €${formatNumber(sharingCiStats.lowest)}
Highest: €${formatNumber(sharingCiStats.highest)}
	`);
	
	return {
		rent: {
			county: rentCoStats,
			city: rentCiStats,
		},
		sharing: {
			county: sharingCoStats,
			city: sharingCiStats,
		},
	};
}).then(
	writeStats
);

function log(str) {
	if (! CONFIG_VERBOSE) {
		return;
	}

	console.log(str);
}

function performCalculations(prices) {
	const lowest = Math.min(...prices);
	const highest = Math.max(...prices);
	const average = calculateAverage(prices);
	const median = calculateMedian(prices);
	
	return {
		lowest,
		highest,
		average,
		median,
	};
}

function calculateAverage(prices) {
	return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function calculateMedian(prices) {
	prices.sort((a, b) => a - b);
	
	const middle = Math.floor(prices.length / 2);
	
	if (prices.length % 2) {
		return prices[middle];
	}
	
	return prices[middle - 1] + prices[middle] / 2.0;
}

function formatNumber(number) {
	return parseFloat(number).toFixed(2)
}

function fetchAllPrices(url, selector, pricesAcc = []) {
	console.log(`Indexing page... ${url}`);
	
	return Promise.delay(INDEX_DELAY).then(
		() => Request(url)
	).then(html => {
		const doc = Cheerio.load(html);
		const prices = pricesAcc.concat(doc(SEL_PRICE).map((i, e) => Cheerio(e).text()).get());
		
		if (doc(SEL_NEXT_PAGE).length === 0) {
			log('Reached last page.');

			return prices;
		}
		
		let nextPageLink = doc(SEL_NEXT_PAGE).attr('href');
		if (nextPageLink.startsWith('/')) {
			nextPageLink = `http://daft.ie${nextPageLink}`;
		}
		
		return fetchAllPrices(nextPageLink, selector, prices);
	}).then(
		prices => prices.map(priceToNumber)
	);
}

function priceToNumber(price) {
	price = String(price).toLowerCase();
	if (price.startsWith('from ')) {
		price = price.substr(5)
	}
	const weekly = price.endsWith('per week');
	
	return parseFloat(price.replace(/[^\d\.]/g, '')) * (weekly ? WEEKS_IN_A_MONTH : 1.0);
}

function writeStats(data) {
	return readPrevious().then(
		stats => ({
			...JSON.parse(stats),
			[new Date()]: data,
		})
	).then(JSON.stringify).then(
		stats => Promise.promisify(Fs.writeFile)(STATS_FILE, stats, 'utf8')
	).then(
		uploadS3
	);
}

function readPrevious(forceLocal = false) {
	if (forceLocal || ! CONFIG_S3_BUCKET) {
		log('Reading previous stats.json file from local filesystem');

		return Promise.promisify(Fs.readFile)(STATS_FILE).catch(
			() => '{}'
		);
	}

	log('Reading previous stats.json file from S3');

	return retrieveS3();
}

function retrieveS3() {
	const S3 = require('aws-sdk/clients/s3');

	const s3Config = CONFIG_S3_ENDPOINT ? {'endpoint': CONFIG_S3_ENDPOINT} : undefined;
	const s3 = new S3(s3Config);

	return s3.getObject({
		Bucket: CONFIG_S3_BUCKET,
		Key: 'stats.json',
	}).promise().then(response => response.Body.toString());
}

function uploadS3() {
	const S3 = require('aws-sdk/clients/s3');
	
	if (! CONFIG_S3_BUCKET) {
		log('Not uploading stats.json to S3');

		return;
	}

	log('Uploading stats.json to S3');
	
	const s3Config = CONFIG_S3_ENDPOINT ? {'endpoint': CONFIG_S3_ENDPOINT} : undefined;
	const s3 = new S3(s3Config);
	
	return readPrevious(true).then(
		stats => s3.upload({
			Bucket: CONFIG_S3_BUCKET,
			Key: `stats-${new Date().toISOString()}.json`,
			Body: stats,
			ACL: 'public-read'
		}).promise().then(() => stats)).then(
			stats => s3.upload({
			Bucket: CONFIG_S3_BUCKET,
			Key: 'stats.json',
			Body: stats,
			ACL: 'public-read'
		}).promise()).then(
			() => log('Uploaded stats.json')
		);
}
