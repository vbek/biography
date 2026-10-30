/* AR Survival — every object and backdrop is drawn in code once, then reused as a bitmap for speed. */
window.ARArt = (() => {
  'use strict';
  const R = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  function mk(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function grad(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    return g;
  }
  function radial(ctx, x, y, r0, r1, stops) {
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    return g;
  }
  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  }
  // draws a shape on the right half and mirrors it, which keeps head-on vehicles symmetrical
  function mirrored(ctx, w, draw) {
    draw(ctx);
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    draw(ctx);
    ctx.restore();
  }

  function rock(hot) {
    return mk(256, 256, (ctx) => {
      const n = 16, pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, r = R(92, 122);
        pts.push([128 + Math.cos(a) * r, 128 + Math.sin(a) * r]);
      }
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % n];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        if (!i) ctx.moveTo(mx, my);
        else ctx.quadraticCurveTo(p[0], p[1], mx, my);
      });
      const p0 = pts[0], q0 = pts[1];
      ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2);
      ctx.closePath();
      ctx.fillStyle = radial(ctx, 96, 88, 8, 165, hot
        ? ['#ffe08a', '#e8732c', '#6d2311', '#250b08']
        : ['#b6aa9c', '#7a6f66', '#3f3833', '#17130f']);
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 11; i++) {
        const x = R(40, 216), y = R(40, 216), r = R(6, 25);
        ctx.fillStyle = hot ? 'rgba(70,14,4,.6)' : 'rgba(18,14,12,.5)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = hot ? 'rgba(255,190,90,.55)' : 'rgba(215,205,190,.28)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x + 1.5, y + 1.5, r, 0.2, 2.4); ctx.stroke();
      }
      for (let i = 0; i < 180; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,245,225' : '0,0,0'},${R(0.05, 0.2)})`;
        ctx.fillRect(R(10, 246), R(10, 246), R(1, 4), R(1, 4));
      }
      ctx.fillStyle = radial(ctx, 92, 82, 70, 215, ['rgba(0,0,0,0)', 'rgba(0,0,0,.72)']);
      ctx.fillRect(0, 0, 256, 256);
      ctx.restore();
    });
  }

  const craft = () => mk(320, 180, (ctx) => {
    ctx.fillStyle = radial(ctx, 160, 124, 8, 118, ['rgba(120,255,235,.85)', 'rgba(80,220,255,.2)', 'rgba(80,220,255,0)']);
    ctx.fillRect(0, 40, 320, 140);
    ctx.fillStyle = grad(ctx, 0, 0, 0, 120, ['#bdf8ff', '#2995c7', '#0d3a58']);
    ctx.beginPath(); ctx.ellipse(160, 74, 54, 48, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.beginPath(); ctx.ellipse(140, 52, 16, 9, -0.55, 0, TAU); ctx.fill();
    ctx.fillStyle = grad(ctx, 0, 60, 0, 124, ['#dfe6ee', '#7f8ca0', '#262e3e']);
    ctx.beginPath(); ctx.ellipse(160, 88, 152, 35, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = grad(ctx, 0, 90, 0, 124, ['#3a4558', '#10141e']);
    ctx.beginPath(); ctx.ellipse(160, 99, 112, 22, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.12 + (i / 8) * 0.76), x = 160 + Math.cos(a) * 136, y = 94 + Math.sin(a) * 23;
      ctx.fillStyle = radial(ctx, x, y, 1, 11, ['#fff', i % 2 ? '#ff4d7a' : '#39f3d9', 'rgba(0,0,0,0)']);
      ctx.fillRect(x - 11, y - 11, 22, 22);
    }
  });

  const jet = () => mk(360, 170, (ctx, w) => {
    mirrored(ctx, w, (c) => {
      c.fillStyle = grad(c, 180, 70, 356, 110, ['#7f8b99', '#4e5966', '#2d3640']);
      poly(c, [[196, 72], [352, 106], [356, 116], [196, 104]]); c.fill();
      c.fillStyle = '#c9d0d8';
      c.fillRect(340, 90, 7, 28);
      c.fillStyle = '#d0393d';
      c.fillRect(340, 90, 7, 8);
      c.fillStyle = grad(c, 196, 0, 240, 0, ['#505b68', '#7c8895']);
      poly(c, [[194, 54], [234, 6], [244, 6], [214, 76]]); c.fill();
      c.fillStyle = '#10151b';
      c.beginPath(); c.ellipse(212, 96, 17, 15, 0, 0, TAU); c.fill();
      c.fillStyle = radial(c, 212, 96, 2, 14, ['#0a0d11', '#3b4552']);
      c.beginPath(); c.ellipse(212, 96, 11, 10, 0, 0, TAU); c.fill();
    });
    ctx.fillStyle = grad(ctx, 150, 0, 210, 0, ['#4b5662', '#a8b3bf', '#4b5662']);
    ctx.beginPath(); ctx.ellipse(180, 88, 27, 47, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = grad(ctx, 0, 40, 0, 78, ['#d7f5ff', '#2e6e97', '#10283d']);
    ctx.beginPath(); ctx.ellipse(180, 60, 15, 18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = radial(ctx, 180, 112, 1, 11, ['#20262c', '#596470']);
    ctx.beginPath(); ctx.arc(180, 112, 9, 0, TAU); ctx.fill();
  });

  const missile = () => mk(180, 180, (ctx, w) => {
    ctx.fillStyle = radial(ctx, 90, 90, 40, 90, ['rgba(255,180,70,.75)', 'rgba(255,90,20,.25)', 'rgba(255,60,0,0)']);
    ctx.fillRect(0, 0, 180, 180);
    ctx.fillStyle = '#5b6570';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(90, 90);
      ctx.rotate((i * Math.PI) / 2);
      poly(ctx, [[-7, -32], [7, -32], [3, -80], [-3, -80]]);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = radial(ctx, 80, 80, 3, 42, ['#f5f7f9', '#a8b1ba', '#47505a']);
    ctx.beginPath(); ctx.arc(90, 90, 37, 0, TAU); ctx.fill();
    ctx.fillStyle = radial(ctx, 84, 84, 2, 25, ['#ffb1a6', '#d82a2a', '#6e0e12']);
    ctx.beginPath(); ctx.arc(90, 90, 23, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.arc(82, 82, 5, 0, TAU); ctx.fill();
    void w;
  });

  const bomber = () => mk(520, 190, (ctx, w) => {
    mirrored(ctx, w, (c) => {
      c.fillStyle = grad(c, 0, 76, 0, 118, ['#6f7a70', '#49534a', '#2c342d']);
      poly(c, [[280, 80], [512, 62], [516, 74], [280, 118]]); c.fill();
      [[346, 92], [426, 82]].forEach(([x, y]) => {
        c.fillStyle = grad(c, 0, y - 22, 0, y + 22, ['#88938a', '#3d463f']);
        c.beginPath(); c.arc(x, y + 8, 22, 0, TAU); c.fill();
        c.fillStyle = radial(c, x, y + 8, 2, 15, ['#050505', '#20241f']);
        c.beginPath(); c.arc(x, y + 8, 15, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(190,210,190,.6)';
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - 13, y + 2); c.lineTo(x + 13, y + 14); c.stroke();
      });
      c.fillStyle = 'rgba(255,255,255,.9)';
      c.fillRect(492, 62, 12, 5);
    });
    ctx.fillStyle = grad(ctx, 248, 0, 272, 0, ['#49534a', '#747f75', '#49534a']);
    poly(ctx, [[252, 76], [268, 76], [264, 4], [256, 4]]); ctx.fill();
    ctx.fillStyle = grad(ctx, 214, 0, 306, 0, ['#39423b', '#8b968c', '#39423b']);
    ctx.beginPath(); ctx.arc(260, 100, 47, 0, TAU); ctx.fill();
    ctx.fillStyle = grad(ctx, 0, 62, 0, 96, ['#c5ecff', '#28506e', '#0a1924']);
    ctx.beginPath(); ctx.ellipse(260, 80, 24, 14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(15,20,15,.75)';
    ctx.beginPath(); ctx.arc(260, 118, 15, 0, TAU); ctx.fill();
  });

  const warship = () => mk(420, 340, (ctx, w) => {
    ctx.fillStyle = '#5e6a76';
    ctx.fillRect(207, 6, 6, 80);
    ctx.fillRect(184, 28, 52, 4);
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(205, 2, 10, 7);
    ctx.fillStyle = grad(ctx, 130, 0, 290, 0, ['#46525e', '#8d9aa8', '#46525e']);
    poly(ctx, [[176, 62], [244, 62], [262, 118], [158, 118]]); ctx.fill();
    ctx.fillStyle = '#121a22';
    ctx.fillRect(176, 80, 68, 11);
    ctx.fillStyle = 'rgba(160,230,255,.55)';
    for (let i = 0; i < 6; i++) ctx.fillRect(180 + i * 11, 82, 7, 6);
    ctx.fillStyle = grad(ctx, 90, 0, 330, 0, ['#3c4751', '#7b8894', '#3c4751']);
    poly(ctx, [[126, 116], [294, 116], [316, 176], [104, 176]]); ctx.fill();
    ctx.fillStyle = '#1b232b';
    for (let i = 0; i < 7; i++) ctx.fillRect(134 + i * 24, 134, 12, 8);
    mirrored(ctx, w, (c) => {
      c.fillStyle = '#2a333c';
      c.fillRect(226, 148, 12, 44);
      c.fillRect(244, 150, 12, 42);
    });
    ctx.fillStyle = grad(ctx, 150, 0, 270, 0, ['#39434d', '#8e9ba8', '#39434d']);
    ctx.beginPath(); ctx.ellipse(210, 192, 56, 21, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = grad(ctx, 60, 0, 360, 0, ['#232c35', '#68747f', '#8d99a5', '#68747f', '#232c35']);
    poly(ctx, [[50, 180], [370, 180], [240, 322], [210, 332], [180, 322]]); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(210, 182); ctx.lineTo(210, 330); ctx.stroke();
    ctx.fillStyle = 'rgba(165,40,40,.62)';
    poly(ctx, [[137, 280], [283, 280], [240, 322], [210, 332], [180, 322]]); ctx.fill();
    ctx.fillStyle = 'rgba(245,252,255,.9)';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('74', 174, 222);
    ctx.fillText('74', 246, 222);
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    for (let i = 0; i < 26; i++) {
      const x = 210 + R(-104, 104);
      ctx.beginPath(); ctx.arc(x, 330 - Math.abs(x - 210) * 0.16 + R(-7, 7), R(4, 12), 0, TAU); ctx.fill();
    }
  });

  const torpedo = () => mk(200, 200, (ctx) => {
    ctx.fillStyle = radial(ctx, 100, 100, 45, 100, ['rgba(255,255,255,.75)', 'rgba(150,230,255,.3)', 'rgba(150,230,255,0)']);
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#26323a';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(100, 100);
      ctx.rotate(Math.PI / 4 + (i * Math.PI) / 2);
      poly(ctx, [[-8, -30], [8, -30], [4, -72], [-4, -72]]);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = radial(ctx, 88, 86, 4, 52, ['#c2d0d4', '#60747c', '#172228']);
    ctx.beginPath(); ctx.arc(100, 100, 45, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(100, 100, 32, 0, TAU); ctx.stroke();
    ctx.fillStyle = radial(ctx, 94, 92, 1, 20, ['#ff9999', '#b4141c', '#470409']);
    ctx.beginPath(); ctx.arc(100, 100, 18, 0, TAU); ctx.fill();
  });

  const bomb = () => mk(120, 240, (ctx) => {
    ctx.fillStyle = '#2d3a30';
    poly(ctx, [[60, 54], [18, 8], [46, 12], [60, 30], [74, 12], [102, 8]]); ctx.fill();
    ctx.fillStyle = grad(ctx, 24, 0, 96, 0, ['#242d25', '#7d8c7e', '#242d25']);
    ctx.beginPath();
    ctx.moveTo(60, 40);
    ctx.bezierCurveTo(100, 62, 100, 158, 60, 232);
    ctx.bezierCurveTo(20, 158, 20, 62, 60, 40);
    ctx.fill();
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(37, 92, 46, 9);
    ctx.fillRect(37, 108, 46, 5);
  });

  const shell = () => mk(120, 280, (ctx) => {
    ctx.fillStyle = grad(ctx, 0, 0, 0, 150, ['rgba(255,190,70,0)', 'rgba(255,150,40,.85)']);
    poly(ctx, [[46, 130], [60, 0], [74, 130]]); ctx.fill();
    ctx.fillStyle = grad(ctx, 30, 0, 90, 0, ['#4a3b22', '#d4bd86', '#4a3b22']);
    ctx.beginPath();
    ctx.moveTo(32, 120);
    ctx.lineTo(88, 120);
    ctx.lineTo(88, 200);
    ctx.quadraticCurveTo(84, 250, 60, 276);
    ctx.quadraticCurveTo(36, 250, 32, 200);
    ctx.fill();
    ctx.fillStyle = '#b34a26';
    ctx.fillRect(32, 150, 56, 12);
  });

  const bolt = () => mk(128, 128, (ctx) => {
    ctx.fillStyle = radial(ctx, 64, 64, 4, 64, ['#ffffff', '#7cffb2', 'rgba(35,240,130,.55)', 'rgba(20,220,120,0)']);
    ctx.fillRect(0, 0, 128, 128);
  });

  const pod = () => mk(160, 160, (ctx) => {
    ctx.fillStyle = grad(ctx, 30, 0, 130, 0, ['#14384f', '#7be7ff', '#14384f']);
    poly(ctx, [[80, 8], [116, 92], [148, 118], [100, 122], [80, 150], [60, 122], [12, 118], [44, 92]]); ctx.fill();
    ctx.fillStyle = grad(ctx, 0, 40, 0, 100, ['#fff', '#2aa3d1']);
    ctx.beginPath(); ctx.ellipse(80, 72, 15, 28, 0, 0, TAU); ctx.fill();
  });

  const ourMissile = () => mk(80, 240, (ctx) => {
    ctx.fillStyle = '#0e7490';
    poly(ctx, [[26, 170], [6, 216], [26, 206]]); ctx.fill();
    poly(ctx, [[54, 170], [74, 216], [54, 206]]); ctx.fill();
    ctx.fillStyle = grad(ctx, 22, 0, 58, 0, ['#64748b', '#f8fafc', '#64748b']);
    ctx.beginPath();
    ctx.moveTo(40, 4);
    ctx.quadraticCurveTo(60, 40, 58, 80);
    ctx.lineTo(58, 210);
    ctx.lineTo(22, 210);
    ctx.lineTo(22, 80);
    ctx.quadraticCurveTo(20, 40, 40, 4);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(40, 4);
    ctx.quadraticCurveTo(54, 30, 56, 56);
    ctx.lineTo(24, 56);
    ctx.quadraticCurveTo(26, 30, 40, 4);
    ctx.fill();
    ctx.fillStyle = grad(ctx, 0, 208, 0, 240, ['#fff7c2', 'rgba(255,140,40,.9)', 'rgba(255,90,20,0)']);
    poly(ctx, [[24, 208], [56, 208], [40, 240]]); ctx.fill();
  });

  // power-ups: a glowing orb in the power's colour with a white symbol, centred on (64, 64)
  const POWER_ICONS = {
    shield(c) {
      c.beginPath();
      c.moveTo(64, 32);
      c.lineTo(88, 41);
      c.quadraticCurveTo(89, 78, 64, 96);
      c.quadraticCurveTo(39, 78, 40, 41);
      c.closePath();
      c.fill();
    },
    repel(c) {
      c.beginPath(); c.arc(64, 64, 8, 0, TAU); c.fill();
      for (let i = 0; i < 4; i++) {
        c.save();
        c.translate(64, 64);
        c.rotate((i * Math.PI) / 2);
        c.beginPath();
        c.moveTo(0, -15); c.lineTo(0, -33);
        c.moveTo(-8, -25); c.lineTo(0, -33); c.lineTo(8, -25);
        c.stroke();
        c.restore();
      }
    },
    ghost(c) {
      c.beginPath();
      c.moveTo(42, 94);
      c.lineTo(42, 58);
      c.arc(64, 58, 22, Math.PI, 0);
      c.lineTo(86, 94);
      c.lineTo(75, 84); c.lineTo(64, 94); c.lineTo(53, 84);
      c.closePath();
      c.fill();
      c.fillStyle = '#334155';
      c.beginPath(); c.arc(56, 58, 5, 0, TAU); c.arc(72, 58, 5, 0, TAU); c.fill();
    },
    slow(c) {
      c.beginPath(); c.arc(64, 64, 28, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(64, 46); c.lineTo(64, 64); c.lineTo(77, 72); c.stroke();
    },
    rapid(c) {
      poly(c, [[70, 28], [42, 70], [60, 70], [54, 100], [86, 56], [67, 56]]);
      c.fill();
    },
    double(c) {
      c.font = '900 42px Orbitron, "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('×2', 64, 66);
    },
    nova(c) {
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU, r = i % 2 ? 15 : 38;
        pts.push([64 + Math.cos(a) * r, 64 + Math.sin(a) * r]);
      }
      poly(c, pts);
      c.fill();
    },
    life(c) {
      c.beginPath();
      c.moveTo(64, 94);
      c.bezierCurveTo(26, 66, 34, 34, 54, 36);
      c.quadraticCurveTo(62, 37, 64, 46);
      c.quadraticCurveTo(66, 37, 74, 36);
      c.bezierCurveTo(94, 34, 102, 66, 64, 94);
      c.fill();
    },
  };
  const POWER_COLORS = { shield: '56,189,248', repel: '167,139,250', ghost: '148,163,184', slow: '52,211,153', rapid: '249,115,22', double: '234,179,8', nova: '236,72,153', life: '239,68,68' };
  const powerOrb = (id) => mk(128, 128, (ctx) => {
    const rgb = POWER_COLORS[id];
    ctx.fillStyle = radial(ctx, 64, 64, 34, 64, [`rgba(${rgb},.75)`, `rgba(${rgb},0)`]);
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = radial(ctx, 52, 48, 4, 58, ['rgba(255,255,255,.55)', `rgba(${rgb},1)`, 'rgba(8,12,28,1)']);
    ctx.beginPath(); ctx.arc(64, 64, 48, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    POWER_ICONS[id](ctx);
  });

  const glow = (rgb, hard) => mk(64, 64, (ctx) => {
    ctx.fillStyle = radial(ctx, 32, 32, 0, 32, hard
      ? [`rgba(${rgb},1)`, `rgba(${rgb},.75)`, `rgba(${rgb},0)`]
      : [`rgba(${rgb},.9)`, `rgba(${rgb},.3)`, `rgba(${rgb},0)`]);
    ctx.fillRect(0, 0, 64, 64);
  });

  const cloud = () => mk(320, 160, (ctx) => {
    for (let i = 0; i < 26; i++) {
      const x = R(50, 270), y = 88 + R(-26, 26), r = R(18, 50);
      ctx.fillStyle = radial(ctx, x, y, 0, r, ['rgba(255,255,255,.5)', 'rgba(255,255,255,0)']);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });

  const sprites = {
    rock0: rock(false), rock1: rock(false), rock2: rock(false), hot: rock(true),
    craft: craft(), jet: jet(), missile: missile(), bomber: bomber(), warship: warship(),
    torpedo: torpedo(), bomb: bomb(), shell: shell(), bolt: bolt(), pod: pod(), cloud: cloud(), ourMissile: ourMissile(),
    power: Object.fromEntries(Object.keys(POWER_ICONS).map((id) => [id, powerOrb(id)])),
  };
  const glows = {
    fire: glow('255,150,50'), hot: glow('255,235,170', true), red: glow('255,60,60'), cyan: glow('90,235,255'),
    white: glow('255,255,255', true), smoke: glow('150,155,165'), dark: glow('55,50,50'), water: glow('205,240,255'),
    green: glow('110,255,170'),
  };

  /* ---------- backdrops: painted once at half resolution for each screen size ---------- */
  function sky(ctx, w, h, stops, end) {
    ctx.fillStyle = grad(ctx, 0, 0, 0, end || h, stops);
    ctx.fillRect(0, 0, w, h);
  }
  function starsOn(ctx, w, h, n) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(255,255,255,${R(0.2, 0.95)})`;
      const s = Math.random() < 0.07 ? 1.8 : 1;
      ctx.fillRect(R(0, w), R(0, h), s, s);
    }
  }
  function nebula(ctx, w, h, colors) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const x = R(0, w), y = R(0, h), r = R(0.2, 0.55) * Math.max(w, h);
      ctx.fillStyle = radial(ctx, x, y, 0, r, [colors[i % colors.length], 'rgba(0,0,0,0)']);
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function planet(ctx, x, y, r, a, b, ring) {
    ctx.fillStyle = radial(ctx, x - r * 0.4, y - r * 0.4, r * 0.1, r * 1.5, [a, b, '#04040a']);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (ring) {
      ctx.strokeStyle = 'rgba(245,220,175,.55)';
      ctx.lineWidth = r * 0.12;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.75, r * 0.42, -0.3, 0.1, Math.PI - 0.1); ctx.stroke();
    }
  }
  function ridge(ctx, w, base, amp, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, base + amp * 3);
    let y = base;
    for (let x = 0; x <= w + 14; x += 14) {
      y += R(-amp, amp) * 0.45;
      y = Math.max(base - amp * 2, Math.min(base + amp, y));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, base + amp * 3);
    ctx.fill();
  }
  function sun(ctx, x, y, r, col) {
    const rgba = col.replace(/[\d.]+\)$/, '');
    ctx.fillStyle = radial(ctx, x, y, 0, r, ['rgba(255,252,235,.95)', `${rgba}.5)`, `${rgba}.14)`, `${rgba}0)`]);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function sea(ctx, w, h, y, stops) {
    ctx.fillStyle = grad(ctx, 0, y, 0, h, stops);
    ctx.fillRect(0, y, w, h - y);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 280; i++) {
      const t = Math.random() ** 2, yy = y + (h - y) * t;
      ctx.fillRect(R(0, w), yy, 3 + t * 34, 1 + t * 2);
    }
  }

  const BACKDROPS = {
    nebula: (c, w, h) => { sky(c, w, h, ['#06041a', '#100a30', '#04040f']); nebula(c, w, h, ['rgba(130,40,190,.22)', 'rgba(25,90,190,.2)', 'rgba(205,45,120,.13)']); starsOn(c, w, h, 420); },
    deep: (c, w, h) => { sky(c, w, h, ['#010207', '#040a18', '#010207']); starsOn(c, w, h, 650); nebula(c, w, h, ['rgba(20,70,130,.08)']); },
    ringed: (c, w, h) => { sky(c, w, h, ['#090514', '#1b0d24', '#050308']); nebula(c, w, h, ['rgba(195,85,45,.11)', 'rgba(95,35,145,.11)']); starsOn(c, w, h, 300); planet(c, w * 0.78, h * 0.26, Math.min(w, h) * 0.2, '#f2c89a', '#a35a33', true); },
    dusk: (c, w, h) => { sky(c, w, h, ['#20265a', '#9b3f6d', '#f28b4c', '#ffd28a'], h * 0.62); sun(c, w * 0.62, h * 0.44, Math.min(w, h) * 0.34, 'rgba(255,175,90,.65)'); ridge(c, w, h * 0.6, h * 0.024, '#5b3158'); ridge(c, w, h * 0.68, h * 0.03, '#2d1c38'); ridge(c, w, h * 0.8, h * 0.04, '#120d1d'); },
    blue: (c, w, h) => { sky(c, w, h, ['#0d5cab', '#3e9ee0', '#b9e6f7'], h * 0.66); sun(c, w * 0.22, h * 0.17, Math.min(w, h) * 0.26, 'rgba(255,245,195,.55)'); ridge(c, w, h * 0.66, h * 0.022, '#7ba1b5'); ridge(c, w, h * 0.77, h * 0.034, '#3f6a56'); ridge(c, w, h * 0.9, h * 0.04, '#21402f'); },
    storm: (c, w, h) => { sky(c, w, h, ['#10141c', '#2c3440', '#566070'], h * 0.7); nebula(c, w, h, ['rgba(120,130,150,.13)']); ridge(c, w, h * 0.72, h * 0.03, '#1a1f28'); ridge(c, w, h * 0.86, h * 0.04, '#090b10'); },
    open: (c, w, h) => { const y = h * 0.34; sky(c, w, h, ['#1f6fb5', '#8ccbe8', '#e5f3f2'], y); sun(c, w * 0.72, y * 0.45, Math.min(w, h) * 0.26, 'rgba(255,240,190,.55)'); sea(c, w, h, y, ['#3f94ac', '#0f5c80', '#063652']); },
    night: (c, w, h) => { const y = h * 0.34; sky(c, w, h, ['#030714', '#0b1630', '#1b2c4d'], y); starsOn(c, w, y, 190); sun(c, w * 0.26, y * 0.42, Math.min(w, h) * 0.12, 'rgba(195,215,255,.6)'); sea(c, w, h, y, ['#10243f', '#061428', '#020810']); },
    gale: (c, w, h) => { const y = h * 0.34; sky(c, w, h, ['#22292f', '#55626a', '#9aa4a2'], y); nebula(c, w, y, ['rgba(70,80,90,.15)']); sea(c, w, h, y, ['#3b5258', '#1a3036', '#0a181d']); },
  };

  function paintBackdrop(id, w, h) {
    const sw = Math.max(2, Math.ceil(w / 2)), sh = Math.max(2, Math.ceil(h / 2));
    return mk(sw, sh, (c) => BACKDROPS[id](c, sw, sh));
  }

  return { sprites, glows, paintBackdrop };
})();
