/* !
 * ${copyright}
 */

// A module
sap.ui.define(["sap/base/security/encodeXML"],
	function(encodeXML) {
		"use strict";

		/**
		 *
		 * @type {{}}
		 */
		var A = {};

		/**
		 *
		 * @param oParam
		 * @param sContent
		 */
		A.x = function(oParam, sContent) {
			if (oParam.iTest === 47) {
				oParam.doIt("background-image", "url('" + encodeXML(sContent) + "')");
			} else if (oParam[0]) {
				return "bla";
			}


			encodeXML(sContent);


			encodeXML(oParam.value);


			encodeXML(encodeXML(encodeXML()));

			A.valueOf();

			true ? encodeXML : abc;
			false ? def : encodeXML;

			this.jQuery.sap.encodeXML("abc");
			this.func().jQuery.sap.encodeXML("def");

			arr[23].jQuery.sap.encodeXML("abc");
			arr["hello"].jQuery.sap.encodeXML("def");
			arr[something].jQuery.sap.encodeXML("ghi");
		};

		return A;
	}, /* bExport= */ true);