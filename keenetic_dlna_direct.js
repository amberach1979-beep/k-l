/* Keenetic DLNA direct for Lampa 3.x / Android APK, v0.3.0 experimental.
   Native HTTP goes directly to 192.168.2.1:8200; no PC, server or credentials.
*/
(function () {
  'use strict';
  if (window.keeneticDlnaDirectLoaded) return;
  window.keeneticDlnaDirectLoaded = true;
  var pluginName = 'Keenetic DLNA Direct';
  var component = 'keenetic_dlna_direct_browser';
  var router = 'http://192.168.2.1:8200';
  var SOAP_ACTION = '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"';
  var endpoint = '';
  var loadingDescription = false;
  var waiting = [];

  function lname(node) {return (node.localName || node.nodeName || '').split(':').pop();}
  function first(parent, tag) {
    if (!parent) return null;
    var all = parent.getElementsByTagName('*');
    for (var i=0;i<all.length;i++) if (lname(all[i])===tag) return all[i];
    return null;
  }
  function txt(parent, tag) {var node = first(parent,tag);return node ? (node.textContent || '') : '';}
  function parseXml(str) {
    var xml = new DOMParser().parseFromString(String(str), 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('Ошибка XML от медиасервера');
    return xml;
  }
  function sameRouter(url) {
    try {
      var a=document.createElement('a');a.href=url;
      return a.protocol==='http:' && a.hostname==='192.168.2.1' && a.port==='8200';
    } catch(e) {return false;}
  }
  function request(url, body, headers, ok, fail) {
    if (!window.Lampa || !Lampa.Reguest) return fail('В этой сборке нет Lampa.Reguest');
    var req=new Lampa.Reguest();
    req.timeout(15000);
    var completed=false;
    function good(data){if(completed)return;completed=true;ok(typeof data==='string'?data:((data&&data.body)||String(data)));}
    function bad(a,b){if(completed)return;completed=true;fail('HTTP-запрос не выполнен: '+(typeof b==='string'?b:(a&&a.status)||'нет ответа'));}
    try {
      if(typeof req.native!=='function') return fail('Нативный HTTP-клиент отсутствует в этой версии APK');
      req.native(url,good,bad,body||false,{dataType:'text',headers:headers||{}});
    } catch(e) {bad(e,e.message);}
  }
  function findControl(done, fail) {
    if(endpoint) return done(endpoint);
    waiting.push({ok:done,fail:fail});
    if(loadingDescription)return;
    loadingDescription=true;
    request(router+'/rootDesc.xml',false,{},function(raw){
      try {
        var xml=parseXml(raw), services=xml.getElementsByTagName('*'), control='';
        for(var i=0;i<services.length;i++){
          if(lname(services[i])!=='service')continue;
          if(txt(services[i],'serviceType').indexOf('ContentDirectory')<0)continue;
          control=txt(services[i],'controlURL').trim();break;
        }
        if(!control) throw new Error('ContentDirectory не найден в rootDesc.xml');
        if(control.indexOf('http://')===0) endpoint=control;
        else endpoint=router+(control.charAt(0)==='/'?'':'/')+control;
        if(!sameRouter(endpoint)) throw new Error('Неожиданный адрес ContentDirectory: '+endpoint);
        waiting.splice(0).forEach(function(w){w.ok(endpoint);});
      } catch(e){waiting.splice(0).forEach(function(w){w.fail(e.message);});}
      loadingDescription=false;
    },function(err){loadingDescription=false;waiting.splice(0).forEach(function(w){w.fail('Не найден rootDesc.xml: '+err);});});
  }
  function escapeXml(text){return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
  function decodeBrowse(raw) {
    var soap=parseXml(raw), fault=first(soap,'Fault');
    if(fault) throw new Error(txt(fault,'faultstring') || 'UPnP SOAP Fault');
    var result=txt(soap,'Result');
    if(!result) throw new Error('DLNA не вернул список файлов');
    var didl=parseXml(result), items=[];
    var children=didl.documentElement.children;
    for(var i=0;i<children.length;i++){
      var el=children[i], kind=lname(el);
      if(kind!=='container'&&kind!=='item')continue;
      var folder=kind==='container',title=txt(el,'title')||'Без названия', url=txt(el,'res').trim(),cls=txt(el,'class');
      if(!folder && !(cls.toLowerCase().indexOf('video')>=0 || /\.(mp4|mkv|avi|mov|ts|m2ts|webm|mpg|mpeg)(?:\?|$)/i.test(url))) continue;
      if(folder || (url && sameRouter(url))) items.push({folder:folder,id:el.getAttribute('id')||'',title:title,url:folder?'':url});
    }
    return items;
  }
  function browse(id, ok,fail) {
    findControl(function(control){
      var soap='<?xml version="1.0" encoding="utf-8"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
        '<s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">' +
        '<ObjectID>'+escapeXml(id)+'</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag>' +
        '<Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>0</RequestedCount>' +
        '<SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>';
      request(control,soap,{'Content-Type':'text/xml; charset="utf-8"','SOAPAction':SOAP_ACTION},function(raw){
        try {ok(decodeBrowse(raw));} catch(e) {fail(e.message);}
      },fail);
    },fail);
  }
  // Keep the original filename and DLNA playback URL; normalize only the on-screen label.
  function movieName(raw) {
    var clean=String(raw||'').replace(/\.(mkv|mp4|avi|mov|ts|m2ts|webm|mpg|mpeg)$/i,'');
    clean=clean.replace(/[._]+/g,' ').replace(/\s+/g,' ').trim();
    var year=clean.match(/(?:^|\s|\()(19\d{2}|20\d{2})(?=\s|\)|$)/);
    var label=clean.replace(/(?:\s|\[|\()(?:19\d{2}|20\d{2})(?:\]|\))?\b.*$/i,'').trim();
    if(!year) label=clean.replace(/\s+(?:480p|720p|1080p|2160p|4k|uhd|bluray|brrip|web[ -]?dl|webrip|hdtv|x264|x265|h264|h265|hevc|hdr|dv|remux|aac|dts)(?:\s|$).*$/i,'').trim();
    return {title:label||clean||raw,year:year?year[1]:''};
  }
  function byTitle(a,b){
    if(a.folder!==b.folder)return a.folder?-1:1;
    return movieName(a.title).title.localeCompare(movieName(b.title).title,'ru',{numeric:true,sensitivity:'base'});
  }
  var sortKey='name',metadataCache={};
  function order(items){
    return items.slice().sort(function(a,b){
      if(sortKey==='original')return 0;
      return byTitle(a,b);
    });
  }
  // Uses Lampa's configured TMDB source when that API is exposed by the installed build.
  // Failure simply leaves a text-only catalog; playback never depends on metadata.
  function lookupMovie(f,callback){
    var info=movieName(f.title),key=(info.title+'|'+info.year).toLowerCase();
    if(Object.prototype.hasOwnProperty.call(metadataCache,key))return callback(metadataCache[key]);
    var source=Lampa.Api&&Lampa.Api.sources&&Lampa.Api.sources.tmdb;
    if(!source||typeof source.search!=='function')return callback(null);
    var finished=false;
    function done(meta){if(finished)return;finished=true;metadataCache[key]=meta||null;callback(meta||null);}
    try {
      source.search({query:info.title,page:1},function(data){
        var lists=[];
        if(Array.isArray(data))lists=data;
        else if(data&&Array.isArray(data.results))lists=data.results;
        else if(data&&Array.isArray(data.movie))lists=data.movie;
        else if(data&&Array.isArray(data.items))lists=data.items;
        var norm=function(v){return String(v||'').toLowerCase().replace(/[^a-zа-яё0-9]/g,'');};
        var match=lists.filter(function(it){
          var mYear=String(it.release_date||it.first_air_date||'').slice(0,4);
          return (norm(it.title)===norm(info.title)||norm(it.original_title)===norm(info.title)) && (!info.year||mYear===info.year);
        })[0];
        done(match||null);
      },function(){done(null);});
    }catch(e){done(null);}
  }
  function Browser(){
    var self=this, html=$('<div class="keenetic-direct"><div class="keenetic-direct-title"></div><div class="keenetic-direct-list"></div></div>');
    var list=html.find('.keenetic-direct-list'), title=html.find('.keenetic-direct-title');
    var scroll=null,history=[{id:'0',title:'Keenetic'}],active=true,seq=0;
    function status(msg){if(scroll){scroll.clear();scroll.append($('<div class="keenetic-direct-status"></div>').text(msg));}else list.empty().text(msg);}
    function refresh(){
      if(!active)return;
      var id=history[history.length-1].id, token=++seq;
      title.text(history.map(function(f){return f.title;}).join(' / ')+'  ·  Сортировка: '+(sortKey==='name'?'А–Я':'как на сервере'));
      list.empty();
      if(scroll){scroll.destroy();scroll=null;}
      scroll=new Lampa.Scroll({mask:true,over:true});list.append(scroll.render(true));
      status('Загрузка с Keenetic…');
      self.activity.loader(true);
      browse(id,function(items){
        if(!active||token!==seq)return;
        scroll.clear();scroll.reset();
        if(!items.length) status('Папка пуста');
        if(items.length){
          var sortBtn=$('<div class="keenetic-direct-item selector keenetic-direct-sort">⇅ Сортировать: '+(sortKey==='name'?'по названию':'как на сервере')+'</div>');
          sortBtn.on('hover:enter',function(){sortKey=sortKey==='name'?'original':'name';refresh();});
          sortBtn.on('hover:focus',function(){scroll.update(sortBtn);});scroll.append(sortBtn);
        }
        order(items).forEach(function(f){
          var item=$('<div class="keenetic-direct-item selector"><span class="keenetic-direct-icon"></span><span class="keenetic-direct-name"></span></div>');
          item.find('.keenetic-direct-icon').text(f.folder?'📁':'▶');
          var info=f.folder?{title:f.title,year:''}:movieName(f.title);
          item.find('.keenetic-direct-name').text(info.title+(info.year?' ('+info.year+')':''));
          if(!f.folder){
            var poster=$('<img class="keenetic-direct-poster" alt="">').hide();
            item.prepend(poster);
            lookupMovie(f,function(meta){
              if(!active||token!==seq||!meta)return;
              var path=meta.poster_path||'';
              if(path&&/^\/[a-zA-Z0-9/_\.-]+$/.test(path)){
                poster.attr('src','https://image.tmdb.org/t/p/w92'+path).show();
                if(meta.overview)item.attr('title',meta.overview);
              }
            });
          }
          item.on('hover:enter',function(){
            if(f.folder){history.push({id:f.id,title:f.title});refresh();}
            else if(f.url){var video={title:movieName(f.title).title,url:f.url};Lampa.Player.play(video);Lampa.Player.playlist([video]);}
          });
          item.on('hover:focus',function(){scroll.update(item);});scroll.append(item);
        });
        self.activity.loader(false);self.activity.toggle();
      },function(err){if(!active||token!==seq)return;self.activity.loader(false);status('Ошибка прямого подключения: '+err+'. Старый плагин с мостом можно оставить как резервный.');self.activity.toggle();});
    }
    this.create=function(){refresh();};
    this.start=function(){
      Lampa.Controller.add('content',{
        invisible:true,toggle:function(){Lampa.Controller.collectionSet(html);Lampa.Controller.collectionFocus(false,html);},
        left:function(){if(Navigator.canmove('left'))Navigator.move('left');else Lampa.Controller.toggle('menu');},
        right:function(){Navigator.move('right');},
        up:function(){if(Navigator.canmove('up'))Navigator.move('up');else Lampa.Controller.toggle('head');},
        down:function(){Navigator.move('down');},
        back:function(){if(history.length>1){history.pop();refresh();}else Lampa.Activity.backward();}
      });Lampa.Controller.toggle('content');
    };
    this.pause=function(){};this.stop=function(){};
    this.render=function(){return html;};
    this.destroy=function(){active=false;seq++;if(scroll)scroll.destroy();html.remove();};
  }
  function init(){
    Lampa.Manifest.plugins={type:'plugin',version:'0.3.0',name:pluginName,description:'Direct UPnP/SOAP for Keenetic at 192.168.2.1, Android only',component:component};
    Lampa.Component.add(component,Browser);
    function insert(){
      if($('.menu .menu__list .keenetic-direct-entry').length)return;
      var button=$('<li class="menu__item selector keenetic-direct-entry"><div class="menu__ico">📁</div><div class="menu__text">Keenetic Direct</div></li>');
      button.on('hover:enter',function(){Lampa.Activity.push({url:'',title:pluginName,component:component,page:1});});
      $('.menu .menu__list').eq(0).append(button);
      $('body').append('<style>.keenetic-direct{padding:1.5em;height:100%}.keenetic-direct-title{font-size:1.4em;margin-bottom:1em}.keenetic-direct-item{padding:1em 1.3em;margin:.5em .7em .5em 0;border-radius:.5em;background:rgba(255,255,255,.10);display:flex;align-items:center;font-size:1.25em}.keenetic-direct-item.focus,.keenetic-direct-item.hover{background:#fff;color:#111}.keenetic-direct-icon{width:2em}.keenetic-direct-poster{width:3.1em;height:4.6em;object-fit:cover;margin-right:.8em;border-radius:.25em}.keenetic-direct-sort{font-size:.92em;opacity:.85}.keenetic-direct-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.keenetic-direct-status{padding:1.5em;font-size:1.2em}</style>');
    }
    if(window.appready)insert();else Lampa.Listener.follow('app',function(e){if(e.type==='ready')insert();});
  }
  if(window.Lampa)init();
})();
