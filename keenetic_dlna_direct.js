/* Keenetic DLNA direct for Lampa 3.x / Android APK, v0.6.0 experimental.
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
  // Metadata: Lampa's TMDB search returns sections [{type:'movie'|'tv',results:[...]}].
  // The main catalog source may remain CUB; this lookup explicitly uses TMDB.
  function lookupMetadata(f, isSeries, callback){
    var info=movieName(f.title), key=(isSeries?'tv|':'movie|')+(info.title+'|'+info.year).toLowerCase();
    if(Object.prototype.hasOwnProperty.call(metadataCache,key))return callback(metadataCache[key]);
    var source=Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb;
    if(!source || typeof source.search!=='function') return callback(null);
    var finished=false;
    function done(meta){if(finished)return;finished=true;metadataCache[key]=meta||null;callback(meta||null);}
    function normal(v){return String(v||'').toLowerCase().replace(/[^a-zа-яё0-9]/g,'');}
    try{
      source.search({query:info.title,page:1},function(data){
        var sections=Array.isArray(data)?data:[data], results=[];
        sections.forEach(function(group){
          if(group && Array.isArray(group.results)) group.results.forEach(function(it){
            var kind=String(it.media_type || group.type || '').toLowerCase();
            if(isSeries ? (kind==='tv' || (!kind && it.name)) : (kind==='movie' || (!kind && it.title))) results.push(it);
          });
        });
        var target=normal(info.title);
        var candidates=results.filter(function(it){
          return normal(it.title)===target || normal(it.name)===target || normal(it.original_title)===target || normal(it.original_name)===target;
        });
        var exactYear=candidates.filter(function(it){
          var year=String(it.release_date||it.first_air_date||'').slice(0,4);
          return info.year && year===info.year;
        });
        done(exactYear[0] || (info.year ? null : candidates[0]) || null);
      },function(){done(null);});
    }catch(e){done(null);}
  }
  function episodeInfo(filename,paths){
    var base=String(filename||'').replace(/\.(?:mkv|mp4|avi|mov|ts|m2ts|webm|mpg|mpeg)$/i,'').replace(/[._]+/g,' ').trim();
    var match=base.match(/(?:^|\s)S(\d{1,2})\s*E(\d{1,3})(?:\s*[-–]?\s*(.*))?$/i) ||
      base.match(/(?:^|\s)(\d{1,2})x(\d{1,3})(?:\s*[-–]?\s*(.*))?$/i);
    var season,episode, seriesTitle='';
    if(match){
      season=parseInt(match[1],10);episode=parseInt(match[2],10);
      seriesTitle=base.slice(0,match.index).replace(/[-–\s]+$/,'').trim();
    }else{
      match=base.match(/(?:Сезон|Season)\s*(\d+)\s*(?:Серия|Episode|Ep)\s*(\d+)/i);
      if(match){season=parseInt(match[1],10);episode=parseInt(match[2],10);seriesTitle=base.slice(0,match.index).trim();}
    }
    var path=(paths||[]).filter(Boolean);
    var seasonFolderIndex=-1,seasonFromFolder=null;
    for(var i=0;i<path.length;i++){
      var sf=path[i].match(/^(?:season|сезон|s)\s*0*(\d+)(?:\b|$)/i);
      if(sf){seasonFolderIndex=i;seasonFromFolder=parseInt(sf[1],10);}
    }
    if(season===undefined && seasonFromFolder!==null){
      // 01.mkv or Episode 01.mkv inside "Season 1".
      var n=base.match(/^(?:(?:episode|ep|серия)\s*)?(\d{1,3})(?:\s*[-–].*)?$/i);
      if(n){season=seasonFromFolder;episode=parseInt(n[1],10);}
    }
    if(season===undefined || episode===undefined) return null;
    if(!seriesTitle){
      if(seasonFolderIndex>=1) seriesTitle=path[seasonFolderIndex-1];
      else if(path.length) seriesTitle=path[path.length-1];
    }
    seriesTitle=seriesTitle.replace(/(?:\s|\.|_)*(?:19\d{2}|20\d{2})?(?:\s|\.|_)*(?:720p|1080p|2160p|4k|bluray|web.?dl|webrip).*$/i,'').trim();
    if(!seriesTitle || /^(video|видео|movies?|фильмы|series|сериалы)$/i.test(seriesTitle))return null;
    var year=(seriesTitle.match(/(?:^|\s|\()(19\d{2}|20\d{2})(?:\s|\)|$)/)||[])[1]||'';
    var clean=movieName(seriesTitle);
    return {title:clean.title,year:year||clean.year,season:season,episode:episode,episodeTitle:base};
  }
  function buildLibrary(files){
    var seriesByKey={},movies=[],shows=[];
    files.forEach(function(f){
      var ep=episodeInfo(f.title,f.paths||[]);
      if(!ep){movies.push(f);return;}
      var key=(ep.title+'|'+ep.year).toLowerCase();
      if(!seriesByKey[key]){
        seriesByKey[key]={title:ep.title,year:ep.year,folder:false,series:true,seasons:{},count:0};
        shows.push(seriesByKey[key]);
      }
      var show=seriesByKey[key];
      if(!show.seasons[ep.season])show.seasons[ep.season]=[];
      show.seasons[ep.season].push({folder:false,title:f.title,url:f.url,episode:ep.episode,season:ep.season,episodeTitle:ep.episodeTitle});
      show.count++;
    });
    Object.keys(seriesByKey).forEach(function(key){
      var show=seriesByKey[key];Object.keys(show.seasons).forEach(function(k){
        show.seasons[k].sort(function(a,b){return a.episode-b.episode || a.title.localeCompare(b.title,'ru',{numeric:true});});
      });
    });
    shows.sort(function(a,b){return a.title.localeCompare(b.title,'ru',{numeric:true});});
    return {shows:shows,movies:order(movies)};
  }
  // Build a flattened catalogue using the existing, already-working native DLNA Browse.
  // No external bridge and no extra permissions. Limit recursion to avoid huge libraries.
  function allMovies(progress, complete, failed) {
    var movies=[], seen={}, jobs=[], requests=0, maxRequests=300, maxDepth=12;
    function enqueue(id,depth,paths){if(!seen[id]&&depth<=maxDepth){seen[id]=true;jobs.push({id:id,depth:depth,paths:paths||[]});}}
    function walk(){
      if(!jobs.length) return complete(movies);
      if(requests>=maxRequests) return complete(movies);
      var job=jobs.shift();requests++;
      browse(job.id,function(entries){
        entries.forEach(function(entry){
          if(entry.folder) enqueue(entry.id,job.depth+1,job.paths.concat([entry.title]));
          else if(entry.url){entry.paths=job.paths;movies.push(entry);}
        });
        if(typeof progress==='function')progress(movies.length,requests);
        walk();
      },failed);
    }
    browse('0',function(root){
      var video=root.filter(function(e){return e.folder && /^(video|видео|films?|фильмы|movies?)$/i.test(e.title.trim());});
      if(video.length){video.forEach(function(e){enqueue(e.id,0,[]);});walk();}
      else {enqueue('0',0,[]);walk();}
    },failed);
  }
  function Browser(){
    var self=this,html=$('<div class="keenetic-direct"><div class="keenetic-direct-title"></div><div class="keenetic-direct-list"></div></div>');
    var list=html.find('.keenetic-direct-list'),title=html.find('.keenetic-direct-title');
    var scroll=null,lastFocus=false,history=[{id:'0',title:'Keenetic'}],active=true,seq=0,catalog=null;
    function status(msg){if(scroll){scroll.clear();scroll.append($('<div class="keenetic-direct-status"></div>').text(msg));}else list.empty().text(msg);}
    function entry(label,action,meta){
      meta=meta||{};
      var item=$('<div class="keenetic-direct-item selector"><span class="keenetic-direct-icon"></span><div class="keenetic-direct-details"><div class="keenetic-direct-name"></div><div class="keenetic-direct-subtitle"></div><div class="keenetic-direct-overview"></div></div></div>');
      item.find('.keenetic-direct-icon').text(meta.icon||'▶');
      item.find('.keenetic-direct-name').text(label);
      var subtitle=item.find('.keenetic-direct-subtitle');
      var overview=item.find('.keenetic-direct-overview');
      if(meta.subtitle) subtitle.text(meta.subtitle).show();else subtitle.hide();
      if(meta.description) overview.text(meta.description).show();else overview.hide();
      item.on('hover:enter',action);
      item.on('hover:focus',function(e){
        lastFocus=e.target;
        if(scroll) scroll.update(item,true);
      });
      // Always attach DOM before metadata lookup, including on navigation back.
      var poster=null;
      if(meta.poster){
        poster=$('<img class="keenetic-direct-poster" alt="">').hide();
        item.prepend(poster);
      }
      scroll.append(item);
      if(poster){
        lookupMetadata({title:meta.title||label},!!meta.series,function(data){
          if(!active || !item.closest('body').length || !data)return;
          var path=data.poster_path;
          if(path && /^\/[a-zA-Z0-9/_\.-]+$/.test(path)){
            poster.attr('src','https://image.tmdb.org/t/p/w185'+path).show();
            poster.on('error',function(){poster.hide();});
          }
          var year=String(data.first_air_date||data.release_date||'').slice(0,4);
          var detail=[];
          if(year && !/\b(?:19|20)\d{2}\b/.test(subtitle.text()))detail.push(year);
          if(data.vote_average && Number(data.vote_average)>0)detail.push('★ '+Number(data.vote_average).toFixed(1));
          if(detail.length)subtitle.text([subtitle.text()].concat(detail).filter(Boolean).join(' · ')).show();
          if(data.overview){overview.text(String(data.overview).replace(/\s+/g,' ').trim().slice(0,360)).show();}
        });
      }
      return item;
    }
    function push(page){history.push(page);refresh();}
    function play(f){var video={title:f.title,url:f.url};Lampa.Player.play(video);Lampa.Player.playlist([video]);}
    function refresh(){
      if(!active)return;
      var page=history[history.length-1],id=page.id,token=++seq;
      title.text(history.map(function(h){return h.title;}).join(' / '));
      lastFocus=false;
      list.empty();if(scroll){scroll.destroy();scroll=null;}
      scroll=new Lampa.Scroll({mask:true,over:true});list.append(scroll.render(true));
      status('Загрузка…');self.activity.loader(true);
      function ready(){if(!active||token!==seq)return;self.activity.loader(false);self.activity.toggle();}
      function failed(err){if(!active||token!==seq)return;status('Ошибка: '+err);ready();}
      function render(items){
        if(!active||token!==seq)return;
        scroll.clear();scroll.reset();
        if(id==='0')entry('🎬 Библиотека: фильмы и сериалы',function(){push({id:'__library__',title:'Библиотека'});},{icon:'🎬'});
        if(items.length)entry('⇅ Сортировка: '+(sortKey==='name'?'А–Я':'как на сервере'),function(){sortKey=sortKey==='name'?'original':'name';refresh();},{icon:'⇅'});
        order(items).forEach(function(f){
          var info=f.folder?{title:f.title,year:''}:movieName(f.title);
          entry(info.title+(info.year?' ('+info.year+')':''),function(){
            if(f.folder)push({id:f.id,title:f.title});else play(f);
          },{icon:f.folder?'📁':'▶',poster:!f.folder,title:f.title});
        });
        if(!items.length && id!=='0')status('Папка пуста');ready();
      }
      function renderLibrary(lib){
        if(!active||token!==seq)return;scroll.clear();scroll.reset();
        entry('📺 Сериалы ('+lib.shows.length+')',function(){push({id:'__series__',title:'Сериалы'});},{icon:'📺',subtitle:'Сериалы с разбивкой по сезонам'});
        entry('🎬 Фильмы ('+lib.movies.length+')',function(){push({id:'__movies__',title:'Фильмы'});},{icon:'🎬',subtitle:'Локальные фильмы с Keenetic'});
        entry('↻ Обновить библиотеку',function(){catalog=null;refresh();},{icon:'↻',subtitle:'Повторно найти новые файлы на диске'});
        ready();
      }
      function showCatalog(lib){
        if(!active||token!==seq)return;scroll.clear();scroll.reset();
        if(id==='__series__'){
          lib.shows.forEach(function(show){
            var seasonCount=Object.keys(show.seasons).length;
            entry(show.title+(show.year?' ('+show.year+')':''),function(){push({id:'__show__',title:show.title,show:show});},{icon:'📺',poster:true,series:true,title:show.title+(show.year?' ('+show.year+')':''),subtitle:seasonCount+' сез. · '+show.count+' сер.'});
          });
          if(!lib.shows.length)status('Сериалов не найдено. Проверь формат имён серий.');
        }else if(id==='__movies__'){
          lib.movies.forEach(function(f){var info=movieName(f.title);entry(info.title+(info.year?' ('+info.year+')':''),function(){play(f);},{icon:'🎬',poster:true,title:f.title,subtitle:'Фильм · на Keenetic'});});
          if(!lib.movies.length)status('Фильмов не найдено');
        }
        ready();
      }
      if(id==='__library__' || id==='__series__' || id==='__movies__'){
        if(catalog){if(id==='__library__')renderLibrary(catalog);else showCatalog(catalog);return;}
        allMovies(function(n,k){if(active&&token===seq)status('Сканирование: '+n+' файлов, '+k+' папок…');},function(files){
          catalog=buildLibrary(files);
          if(id==='__library__')renderLibrary(catalog);else showCatalog(catalog);
        },failed);return;
      }
      if(id==='__show__'){
        scroll.clear();scroll.reset();
        var seasons=Object.keys(page.show.seasons).map(Number).sort(function(a,b){return a-b;});
        seasons.forEach(function(season){
          var files=page.show.seasons[season];
          entry('Сезон '+season,function(){push({id:'__season__',title:'Сезон '+season,show:page.show,season:season});},{icon:'📁',subtitle:files.length+' серий'});
        });ready();return;
      }
      if(id==='__season__'){
        scroll.clear();scroll.reset();
        page.show.seasons[page.season].forEach(function(f){
          entry('Серия '+f.episode,function(){play(f);},{icon:'▶',subtitle:f.episodeTitle||''});
        });ready();return;
      }
      browse(id,render,failed);
    }
    this.create=function(){refresh();};
    this.start=function(){
      Lampa.Controller.add('content',{
        invisible:true,toggle:function(){Lampa.Controller.collectionSet(scroll.render(true),html);Lampa.Controller.collectionFocus(lastFocus || false,scroll.render(true));},
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
    Lampa.Manifest.plugins={type:'plugin',version:'0.6.0',name:pluginName,description:'Direct UPnP/SOAP for Keenetic at 192.168.2.1, Android only',component:component};
    Lampa.Component.add(component,Browser);
    function insert(){
      if($('.menu .menu__list .keenetic-direct-entry').length)return;
      var button=$('<li class="menu__item selector keenetic-direct-entry"><div class="menu__ico">📁</div><div class="menu__text">Keenetic Direct</div></li>');
      button.on('hover:enter',function(){Lampa.Activity.push({url:'',title:pluginName,component:component,page:1});});
      $('.menu .menu__list').eq(0).append(button);
      $('body').append('<style>.keenetic-direct{padding:1.5em;height:100%;box-sizing:border-box;display:flex;flex-direction:column}.keenetic-direct-title{font-size:1.35em;margin-bottom:.65em;flex:0 0 auto}.keenetic-direct-list{flex:1 1 auto;min-height:0;overflow:hidden}.keenetic-direct-list>.scroll{height:100%}.keenetic-direct-item{padding:.65em 1em;margin:.35em .6em .35em 0;border-radius:.5em;background:rgba(255,255,255,.10);display:flex;align-items:center;min-height:3.4em;font-size:1.1em;box-sizing:border-box}.keenetic-direct-item.focus,.keenetic-direct-item.hover{background:#fff;color:#111}.keenetic-direct-icon{min-width:2.2em}.keenetic-direct-poster{width:4.1em;height:6em;object-fit:cover;margin-right:1em;border-radius:.3em;flex:none}.keenetic-direct-details{min-width:0;flex:1;display:flex;flex-direction:column;gap:.17em}.keenetic-direct-name{overflow:hidden;text-overflow:ellipsis;white-space:normal;font-weight:600}.keenetic-direct-subtitle{font-size:.75em;opacity:.74}.keenetic-direct-overview{font-size:.78em;opacity:.83;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.keenetic-direct-status{padding:1em;font-size:1.2em}</style>');
    }
    if(window.appready)insert();else Lampa.Listener.follow('app',function(e){if(e.type==='ready')insert();});
  }
  if(window.Lampa)init();
})();
