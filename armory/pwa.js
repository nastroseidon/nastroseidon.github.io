// Offline support and update notice for the home-screen app
if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register('sw.js').catch(function(){});
  var hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',function(){
    if(!hadController){hadController=true;return}
    var b=document.createElement('button');b.className='updatebar';b.textContent='Sanctuary Armory was updated · tap to reload';
    b.onclick=function(){location.reload()};document.body.appendChild(b);
  });
}
