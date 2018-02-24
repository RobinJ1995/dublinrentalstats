const Cheerio = require('cheerio');
const Request = require('request-promise');
const Promise = require('bluebird');
const Fs = require('fs');

const URL_RENT_CO_PL = 'http://www.daft.ie/dublin/residential-property-for-rent/?sort_by%5D=price&s%5Bsort_type%5D=a';
const URL_RENT_CO_PH = 'http://www.daft.ie/dublin/residential-property-for-rent/?sort_by%5D=price&s%5Bsort_type%5D=d';
const URL_RENT_CI_PL = 'http://www.daft.ie/dublin-city/residential-property-for-rent/?s[sort_by]=price&s[sort_type]=a&searchSource=rental';
const URL_RENT_CI_PH = 'http://www.daft.ie/dublin-city/residential-property-for-rent/?s[sort_by]=price&s[sort_type]=d&searchSource=rental';

const URL_SHARING_CO_PL = 'http://www.daft.ie/dublin/rooms-to-share/?s%5Broom_type%5D=either&s%5Badvanced%5D=1&s%5Bgender%5D=on&s%5Bsort_by%5D=price&s%5Bsort_type%5D=a&searchSource=sharing';
const URL_SHARING_CO_PH = 'http://www.daft.ie/dublin/rooms-to-share/?s%5Broom_type%5D=either&s%5Badvanced%5D=1&s%5Bgender%5D=on&s%5Bsort_by%5D=price&s%5Bsort_type%5D=d&searchSource=sharing';
const URL_SHARING_CI_PL = 'http://www.daft.ie/dublin/rooms-to-share/dublin-city-centre/?s%5Broom_type%5D=either&s%5Badvanced%5D=1&s%5Bgender%5D=on&s%5Bsort_by%5D=price&s%5Bsort_type%5D=a&searchSource=sharing';
const URL_SHARING_CI_PH = 'http://www.daft.ie/dublin/rooms-to-share/dublin-city-centre/?s%5Broom_type%5D=either&s%5Badvanced%5D=1&s%5Bgender%5D=on&s%5Bsort_by%5D=price&s%5Bsort_type%5D=d&searchSource=sharing';

//const SEL_P1 = '#sr_content > tbody > tr > td:nth-child(1) > div:nth-child(2) > div.text-block > div > strong';
const SEL_P1 = 'div.box:nth-child(5) > div:nth-child(3) > div:nth-child(1) > strong:nth-child(1)';

const WEEKS_IN_A_MONTH = 4.34524; // https://www.google.ie/search?q=weeks+in+a+month //
const STATS_FILE = 'stats.json';

const promises = [];

// Rent
promises.push(fetchSelect(URL_RENT_CO_PL, SEL_P1));
promises.push(fetchSelect(URL_RENT_CO_PH, SEL_P1));
promises.push(fetchSelect(URL_RENT_CI_PL, SEL_P1));
promises.push(fetchSelect(URL_RENT_CI_PH, SEL_P1));

// Sharing
promises.push(fetchSelect(URL_SHARING_CO_PL, SEL_P1));
promises.push(fetchSelect(URL_SHARING_CO_PH, SEL_P1));
promises.push(fetchSelect(URL_SHARING_CI_PL, SEL_P1));
promises.push(fetchSelect(URL_SHARING_CI_PH, SEL_P1));

Promise.all(promises).then(
	output => output.map(priceToNumber)
).then(output => {
	const [
		rentCoPL,
		rentCoPH,
		rentCiPL,
		rentCiPH,
		sharingCoPL,
		sharingCoPH,
		sharingCiPL,
		sharingCiPH,
	] = output;
	
	console.log(`
########
# Rent #
########

Co. Dublin
##########
Lowest: €${rentCoPL}
Highest: €${rentCoPH}

City Centre
###########
Lowest: €${rentCiPL}
Highest: €${rentCiPH}

###########
# Sharing #
###########

Co. Dublin
##########
Lowest: €${sharingCoPL}
Highest: €${sharingCoPH}

City Centre
###########
Lowest: €${sharingCiPL}
Highest: €${sharingCiPH}
	`);
	
	return output;
}).then(
	writeStats
);

function fetchSelect(url, selector) {
	return Request(url).then((html) => {
		const doc = Cheerio.load(html);
	
		return doc(selector).text();
	})
}

function priceToNumber(price) {
	price = price.toLowerCase();
	if (price.startsWith('from ')) {
		price = price.substr(5)
	}
	const weekly = price.endsWith('per week');
	
	return (parseFloat(price.replace(/[^\d\.]/g, '')) * (weekly ? WEEKS_IN_A_MONTH : 1.0)).toFixed(2);
}

function writeStats([
		rentCoPL,
		rentCoPH,
		rentCiPL,
		rentCiPH,
		sharingCoPL,
		sharingCoPH,
		sharingCiPL,
		sharingCiPH,
	]) {
	
	return Promise.promisify(Fs.readFile)(STATS_FILE).catch(
		() => ({})
	).then(
		stats => ({
			...stats,
			[new Date()]: {
				rent: {
					county: {
						lowest: rentCoPL,
						highest: rentCoPH,
					},
					city: {
						lowest: rentCiPL,
						highest: rentCiPH,
					},
				},
				sharing: {
					county: {
						lowest: sharingCoPL,
						highest: sharingCoPH,
					},
					city: {
						lowest: sharingCiPL,
						highest: sharingCiPH,
					},
				},
			}
		})
	).then(JSON.stringify).then(
		stats => Promise.promisify(Fs.writeFile)(STATS_FILE, stats, 'utf8')
	);
}
