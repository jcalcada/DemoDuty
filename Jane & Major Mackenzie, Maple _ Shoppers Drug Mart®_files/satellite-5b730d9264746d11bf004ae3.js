_satellite.pushBlockingScript(function(event, target, $variables){
  
  /***************************************************************************/
  /******************************* PAGE LOADS ********************************/
  /***************************************************************************/

  !function(f,b,e,v,n,t,fbs)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
   if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
   n.queue=[];t=b.createElement(e);t.async=!0;
   t.src=v;fbs=b.getElementsByTagName(e)[0];
   fbs.parentNode.insertBefore(t,fbs)}(window, document,'script',
                                   'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '172824123093840');
  fbq('init', '782383072151976');
  fbq('track', 'PageView');

});
