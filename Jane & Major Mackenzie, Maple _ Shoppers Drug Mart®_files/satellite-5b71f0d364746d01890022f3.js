_satellite.pushBlockingScript(function(event, target, $variables){
  
  /***************************************************************************/
  /******************************* PAGE LOADS ********************************/
  /***************************************************************************/

	t=document.createElement('script');
	t.async=!0;
	t.src="https://www.googletagmanager.com/gtag/js?id=AW-942102971&l=googleDataLayer";
	googs=document.getElementsByTagName('script')[0];
	googs.parentNode.insertBefore(t,googs)

	window.googleDataLayer = window.googleDataLayer || [];
	function gtag(){googleDataLayer.push(arguments);}
	gtag('js', new Date());

  // 2971 is the BB MCC Account
  gtag('config', 'AW-942102971');
  // 9570 is the BB Search Account
  gtag('config', 'AW-941229570');
  // 2412 is the BB Display/Video Account
  gtag('config', 'AW-942782412');
  // 4291 is the BB Shopping Campaigns Account
  gtag('config', 'AW-852344291');
 
});
