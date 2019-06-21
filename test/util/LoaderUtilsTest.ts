const assert = require("assert");

const request = require("request");
const sinon = require("sinon");
const fs = require("fs");

import * as LoaderUtils from "../../src/util/LoaderUtils";

describe("LoaderUtils", function() {
	beforeEach(function() {
		LoaderUtils.resetCache();
	});

	afterEach(function() {
		LoaderUtils.resetCache();
	});


	it("resource fs cache", function() {
		const dataObject = { num : 47 };
		const oStub = sinon.stub(fs, "readFile");
		oStub.callsArgWith(1, false, JSON.stringify(dataObject));


		const req1 = LoaderUtils.fetchResource("mykey");
		const req2 = LoaderUtils.fetchResource("mykey");
		const req3 = LoaderUtils.fetchResource("mykey2");

		return Promise.all([ req1, req2, req3 ]).then(() => {
			assert.equal(
				oStub.callCount, 2,
				"should be called twice (for mykey and mykey2)");
			oStub.restore();
		});
	});


	it("resource request cache", function() {
		const dataObject = { num : 47 };
		const oStub = sinon.stub(request, "get");
		oStub.callsArgWith(1, "", "", JSON.stringify(dataObject));
		const req1 = LoaderUtils.fetchResource("http://myurl/myfile.json");
		const req2 = LoaderUtils.fetchResource("http://myurl/myfile2.json");
		const req3 = LoaderUtils.fetchResource("http://myurl/myfile.json");

		return Promise.all([ req1, req2, req3 ]).then(() => {
			assert.equal(
				oStub.callCount, 2,
				"should be called twice (for myfile and myfile2)");
			oStub.restore();
		});
	});

	it("fetch resource with empty string", function(done) {
		LoaderUtils.fetchResource("").then(function(data) {
			assert.deepEqual(data, {}, "empty object");
			done();
		});
	});

	it("fetch resource with file string", function(done) {
		const oStub = sinon.stub(fs, "readFile");
		oStub.callsArgWith(1, "file does not exist", "");
		LoaderUtils.fetchResource("./asd.asd")
			.then(
				function(data) {
					assert.fail("should not exist");
					oStub.restore();
				},
				function(err) {
					assert.ok(err, "file should not exist");
					oStub.restore();
					done();
				});
	});

	it("fetch resource with http string", function(done) {
		const oStub = sinon.stub(request, "get");
		oStub.callsArgWith(1, "", "", "{}");
		LoaderUtils.fetchResource("http://myurl/myfile.json")
			.then(function(data) {
				assert.deepEqual(data, {}, "empty object");
				oStub.restore();
				done();
			});
	});

	it("fetch resource with erroneous http string", function(done) {
		const oStub = sinon.stub(request, "get");
		oStub.callsArgWith(1, "file does not exist", "", "");
		LoaderUtils.fetchResource("http://myurl/myfile.json")
			.then(
				function(data) {
					assert.fail("should not exist");
				},
				function(err) {
					assert.ok(err, "file should not exist");
					oStub.restore();
					done();
				});
	});
});
