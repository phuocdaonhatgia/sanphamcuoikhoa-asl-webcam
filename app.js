let camIsOn = false;
let pollTimer = null;
function dismissModal() {
  document.getElementById('camModal').classList.add('hidden');
}
async function startCamera() {
  dismissModal();


  await fetch('/camera', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action:'start'})
  });

  camIsOn = true;


  const btn = document.getElementById('camToggleBtn');
  btn.className = 'cam-toggle on';
  document.getElementById('camToggleIcon').textContent = '⏹';
  document.getElementById('camToggleTxt').textContent  = 'Tắt Camera';


  const offScreen  = document.getElementById('camOffScreen');
  const loadingTxt = document.getElementById('camLoadingTxt');
  const camOffBtn  = document.getElementById('camOffBtn');
  offScreen.classList.remove('hidden');
  loadingTxt.textContent = '⏳ Đang mở webcam...';
  camOffBtn.style.display = 'none';


  const feed = document.getElementById('feed');
  feed.src = '/video?' + Date.now();
  feed.style.display = 'block';


  feed.onload = () => {
    offScreen.classList.add('hidden');
    document.getElementById('camOverlay').classList.remove('hidden');
  };

  setTimeout(() => {
    offScreen.classList.add('hidden');
    document.getElementById('camOverlay').classList.remove('hidden');
  }, 5000);
}


async function stopCamera() {

  const feed = document.getElementById('feed');
  feed.src   = '';
  feed.style.display = 'none';
  feed.onload = null;


  await fetch('/camera', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action:'stop'})
  });

  camIsOn = false;


  const btn = document.getElementById('camToggleBtn');
  btn.className = 'cam-toggle off';
  document.getElementById('camToggleIcon').textContent = '▶';
  document.getElementById('camToggleTxt').textContent  = 'Bật Camera';

  const offScreen  = document.getElementById('camOffScreen');
  const loadingTxt = document.getElementById('camLoadingTxt');
  const camOffBtn  = document.getElementById('camOffBtn');
  offScreen.classList.remove('hidden');
  document.getElementById('camOverlay').classList.add('hidden');
  loadingTxt.textContent = 'Camera đang tắt';
  camOffBtn.style.display = 'inline-block';

  document.getElementById('bigChar').textContent   = '—';
  document.getElementById('confLabel').textContent = '0%';
  document.getElementById('progFill').style.width  = '0%';
}

async function toggleCamera() {
  if (camIsOn) await stopCamera();
  else         await startCamera();
}


function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(poll, 160);
}

let serverLive = false;
async function poll() {
  try {
    const r = await fetch('/state');
    const d = await r.json();

    if (!serverLive) {
      serverLive = true;
      document.getElementById('dot').classList.add('live');
      document.getElementById('statusTxt').textContent = 'Server OK';
    }

    if (d.cam_on && camIsOn) {
      const raw  = d.label || 'nothing';
      const disp = raw==='space'?'SPC': raw==='del'?'DEL': raw==='nothing'?'—': raw.toUpperCase();
      const high = d.confidence >= 0.70;
      document.getElementById('bigChar').textContent = disp;
      document.getElementById('bigChar').style.color = high ? 'var(--accent)' : 'var(--warn)';
      document.getElementById('confLabel').textContent = (d.confidence*100).toFixed(0) + '%';
      document.getElementById('progFill').style.width = (d.progress*100).toFixed(1) + '%';
    }


    const txt = d.current_text || '';
    document.getElementById('typingTxt').textContent = txt;

    if (txt.trim()) {
      let cor = txt.trim().toLowerCase().replace(/(?:^|\.\s+)\w/g, c=>c.toUpperCase());
      if (!'.!?'.includes(cor.slice(-1))) cor += '.';
      document.getElementById('correctedBox').textContent = cor;
    } else {
      document.getElementById('correctedBox').textContent = '—';
    }

    renderSentences(d.sentences || []);
  } catch(e) {
    serverLive = false;
    document.getElementById('dot').classList.remove('live');
    document.getElementById('dot').classList.add('warn');
    document.getElementById('statusTxt').textContent = 'Mất kết nối';
  }
}


setInterval(poll, 300);
poll();


function renderSentences(list) {
  document.getElementById('sentCount').textContent = list.length + ' câu';
  const el = document.getElementById('sentList');
  if (!list.length) {
    el.innerHTML = '<span class="empty">Nhấn ✅ Lưu câu để lưu kết quả.</span>';
    return;
  }
  el.innerHTML = '';
  list.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'sent-item';
    div.innerHTML = `<span class="sent-num">${String(i+1).padStart(2,'0')}</span>`
                  + `<span class="sent-txt">${esc(s)}</span>`
                  + `<button class="sent-del" onclick="delSent(${i})">✕</button>`;
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}


async function act(action) {
  await fetch('/action', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action})
  });
}
async function delSent(idx) {
  await fetch('/action', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action:'delete_sentence', idx})
  });
}


document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space')     { e.preventDefault(); act('space'); }
  if (e.code === 'Backspace') { e.preventDefault(); act('delete'); }
  if (e.code === 'Enter')     { e.preventDefault(); act('finish'); }
});


let uploadLabel = '';
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e  => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag');
  handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const b64 = e.target.result;
    document.getElementById('previewImg').src = b64;
    document.getElementById('uploadSection').style.display = 'flex';
    document.getElementById('dropZone').style.display = 'none';

    const resp = await fetch('/predict_image', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({image: b64})
    });
    const d = await resp.json();
    if (d.error) { alert('Lỗi: ' + d.error); return; }

    uploadLabel = d.label;
    const disp = d.label==='space'?'SPACE': d.label==='del'?'DEL': d.label==='nothing'?'NOTHING': d.label.toUpperCase();
    document.getElementById('urChar').textContent = disp + '  ' + (d.confidence*100).toFixed(0) + '%';
    document.getElementById('urChar').style.color = d.confidence>=0.70 ? 'var(--accent)' : 'var(--warn)';

    const container = document.getElementById('top5Bars');
    container.innerHTML = '';
    (d.top5||[]).forEach(item => {
      const pct = (item.conf*100).toFixed(1);
      container.innerHTML += `<div class="bar-row">
        <span class="name">${item.name}</span>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        <span class="pct">${pct}%</span>
      </div>`;
    });
  };
  reader.readAsDataURL(file);
}

async function addFromUpload() {
  if (!uploadLabel) return;
  await fetch('/action', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action:'add_char', label: uploadLabel})
  });
  resetUpload();
}
function resetUpload() {
  uploadLabel = '';
  document.getElementById('uploadSection').style.display = 'none';
  document.getElementById('dropZone').style.display = 'block';
  document.getElementById('fileInput').value = '';
  document.getElementById('urChar').textContent = '—';
  document.getElementById('top5Bars').innerHTML = '';
}

function switchTab(name) {
  ['cam','upload'].forEach(id => {
    const isActive = id === name;
    document.querySelectorAll('.tab')[id==='cam'?0:1].classList.toggle('active', isActive);
    document.getElementById('tab-'+id).classList.toggle('active', isActive);
  });
}

function esc(s) {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}