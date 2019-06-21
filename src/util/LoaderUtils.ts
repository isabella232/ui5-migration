const url = require("url");
const fs = require("fs");
const request = require("request");


/**
 * cache requests, ensure that each request is only triggered once per URL.
 * Use #resetCache to clear it.
 *
 * Key: vResourceLocation
 * Value: fetchResource Promise which resolves with the respective JSON object
 */
const requestsCache = new Map();

/**
 * Resets the resource cache
 */
export async function resetCache() {
	requestsCache.clear();
}

/**
 * Performs a request either to a network resource or to the filesystem to
 * asynchronously load the resource.
 * @param {string|object} vResourceLocation
 * @return {Promise}
 */
export async function fetchResource(vResourceLocation: object|
									string): Promise<object> {
	if (typeof vResourceLocation === "object") {
		return Promise.resolve(vResourceLocation);
	} else if (typeof vResourceLocation === "string" && vResourceLocation) {
		if (requestsCache.has(vResourceLocation)) {
			return requestsCache.get(vResourceLocation);
		}

		let fetchResourcePromise: Promise<object>;
		const oParsedUrl = url.parse(vResourceLocation);
		if (oParsedUrl.protocol && oParsedUrl.host) {
			fetchResourcePromise = new Promise(function(resolve, reject) {
				request.get(
					vResourceLocation,
					function(error: string, response: string, body: string) {
						if (error) {
							reject(error);
						} else {
							try {
								resolve(JSON.parse(body));
							} catch (e) {
								reject(e);
							}
						}
					});
			});
		} else {
			fetchResourcePromise = new Promise(function(resolve, reject) {
				fs.readFile(
					vResourceLocation, function(err: string, data: string) {
						if (err) {
							reject(err);
						} else {
							resolve(JSON.parse(data));
						}
					});
			});
		}
		requestsCache.set(vResourceLocation, fetchResourcePromise);
		return fetchResourcePromise;

	} else {
		return Promise.resolve({});
	}
}