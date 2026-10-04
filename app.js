/**
 * Ficha Clínica y Sala de Situación Epidemiológica
 * Dirección de Asistencia y Tratamiento (MDS Corrientes)
 */

const SUPABASE_URL = window.ENV?.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('[Config] Faltan SUPABASE_URL / SUPABASE_ANON_KEY. Defina window.ENV antes de cargar app.js.');
}

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const state = { pacienteActual: null, currentUser: null };
const SEARCH_LIMIT = 50;
const ADMIN_EMAILS = ['armandojara07@gmail.com', 'laurandreabenitez@gmail.com'];

// --- AUDITORÍA Y TRAZABILIDAD ---
async function registrarActividad(accion, detalle, metadata = {}) {
  if (!state.currentUser) return;
  try {
    await supabaseClient.from('user_activity_log').insert([{
      user_id: state.currentUser.id,
      user_email: state.currentUser.email,
      user_name: obtenerNombreProfesional(state.currentUser),
      accion: accion,
      detalle: detalle,
      metadata: metadata
    }]);
  } catch (err) {
    console.warn('[AuditLogErr]', err);
  }
}

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
  inicializarEventos();

  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (session?.user) {
      const remember = localStorage.getItem('mds_remember_me') === '1';
      const isActiveSession = sessionStorage.getItem('mds_session_active') === '1';

      if (!remember && !isActiveSession) {
        await supabaseClient.auth.signOut();
        mostrarLogin();
      } else {
        state.currentUser = session.user;
        mostrarDashboard(session.user);
      }
    } else {
      mostrarLogin();
    }
  } catch (err) {
    console.error('[AuthError]', err);
    mostrarLogin();
  }

  asegurarBotonEditarFicha();
});

// --- ROLES ---
function esAdministrador(user) {
  if (!user?.email) return false;
  if (ADMIN_EMAILS.map(e => e.toLowerCase()).includes(user.email.toLowerCase())) return true;
  if (user.user_metadata?.role === 'admin') return true;
  return false;
}

function actualizarUIAdmin() {
  const cont = document.getElementById('adminActions');
  if (!cont) return;
  const esAdmin = esAdministrador(state.currentUser);
  cont.classList.toggle('hidden', !esAdmin);
  if (esAdmin) cargarAlertasSeguridad();
}

async function cargarAlertasSeguridad() {
  const lista = document.getElementById('listaAlertasSeguridad');
  const badge = document.getElementById('badgeAlertasCount');
  if (!lista) return;

  if (!esAdministrador(state.currentUser)) {
    lista.innerHTML = '';
    if (badge) badge.textContent = '0';
    return;
  }

  lista.innerHTML = '<p class="text-slate-500 text-center py-2">Cargando alertas...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('export_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const alertas = (data || []).filter(row => {
      const meta = row.metadata || {};
      return meta.alerta_seguridad === true || meta.alerta_seguridad === 'true';
    });

    if (badge) badge.textContent = String(alertas.length);

    if (alertas.length === 0) {
      lista.innerHTML = '<p class="text-emerald-700 text-center py-3 font-medium">Sin alertas de seguridad recientes.</p>';
      return;
    }

    lista.innerHTML = '';
    const fragment = document.createDocumentFragment();

    alertas.forEach(row => {
      const meta = row.metadata || {};
      const fecha = row.created_at
        ? new Date(row.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';

      const tipoLabel = row.tipo === 'base_completa' ? 'Exportación masiva' : 'Ficha individual';
      const quien = row.user_name || row.user_email || 'Usuario desconocido';
      const motivo = row.motivo || 'Sin motivo';
      const motivoAlerta = meta.alerta_motivo || (meta.fuera_de_horario ? 'Fuera de horario habitual' : 'Alerta registrada');
      const cantidad = meta.cantidad_registros != null ? ` · ${meta.cantidad_registros} registros` : '';
      const dni = row.paciente_dni ? ` · DNI ${row.paciente_dni}` : '';

      const card = document.createElement('div');
      card.className = 'rounded-xl border border-amber-200 bg-white px-3 py-2.5 shadow-sm';

      const titulo = document.createElement('p');
      titulo.className = 'font-semibold text-slate-800';
      titulo.textContent = `${quien} — ${tipoLabel}${dni}${cantidad}`;

      const detalle = document.createElement('p');
      detalle.className = 'text-slate-600 mt-0.5';
      detalle.textContent = `Motivo: ${motivo}`;

      const metaLine = document.createElement('p');
      metaLine.className = 'text-amber-800 mt-1 font-medium';
      metaLine.textContent = `⚠ ${motivoAlerta} · ${fecha}`;

      card.append(titulo, detalle, metaLine);
      fragment.appendChild(card);
    });

    lista.appendChild(fragment);
  } catch (err) {
    console.error('[AlertasSeguridad]', err);
    lista.innerHTML = `<p class="text-red-600 text-center py-2">No se pudieron cargar las alertas.<br><span class="text-[10px]">${err.message || ''}</span></p>`;
    if (badge) badge.textContent = '!';
  }
}

// --- EVENTOS ---
function inicializarEventos() {
  const zonasProtegidas = ['resultadoBusqueda', 'detalleFichaPaciente', 'tablaPacientesBody'];
  document.addEventListener('contextmenu', e => {
    if (zonasProtegidas.some(id => {
      const el = document.getElementById(id);
      return el && el.contains(e.target);
    })) e.preventDefault();
  });

  document.addEventListener('keydown', e => {
    const key = e.key?.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'x' || key === 'a')) {
      const sel = window.getSelection?.()?.toString();
      if (sel && zonasProtegidas.some(id => {
        const el = document.getElementById(id);
        return el && el.contains(window.getSelection()?.anchorNode);
      })) e.preventDefault();
    }
  });

  document.getElementById('togglePassword')?.addEventListener('change', (e) => {
    const input = document.getElementById('loginPassword');
    if (input) input.type = e.target.checked ? 'text' : 'password';
  });

  document.getElementById('loginForm')?.addEventListener('submit', manejarLogin);
  document.getElementById('logoutBtn')?.addEventListener('click', async e => {
    e.preventDefault();
    try { 
      await registrarActividad('LOGOUT', 'Cierre de sesión manual');
      await supabaseClient.auth.signOut(); 
    } catch (err) { console.error(err); }
    finally {
      state.pacienteActual = null;
      state.currentUser = null;
      localStorage.removeItem('mds_remember_me');
      sessionStorage.removeItem('mds_session_active');
      mostrarLogin();
      location.reload();
    }
  });

  document.getElementById('btnNuevaFicha')?.addEventListener('click', () => {
    state.pacienteActual = null;
    toggleVisibilidadSecciones({ dashboard: false, formulario: true });
    document.getElementById('clinicalForm')?.reset();
    const provinciaEl = document.getElementById('provincia');
    if (provinciaEl) provinciaEl.value = 'Corrientes';
    document.getElementById('latitud').value = '';
    document.getElementById('longitud').value = '';
    const geoStatus = document.getElementById('geoStatus');
    if (geoStatus) geoStatus.textContent = '';
    const status = document.getElementById('clinicalStatus');
    if (status) status.classList.add('hidden');
    
    const motivoEl = document.getElementById('motivoConsulta');
    const obsEl = document.getElementById('observaciones');
    if (motivoEl) {
      motivoEl.readOnly = false;
      motivoEl.classList.remove('bg-slate-100', 'cursor-not-allowed');
    }
    if (obsEl) {
      obsEl.readOnly = false;
      obsEl.classList.remove('bg-slate-100', 'cursor-not-allowed');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('btnVolverDashboard')?.addEventListener('click', () => {
    toggleVisibilidadSecciones({ dashboard: true, formulario: false });
    limpiarVistaInicial();
    cargarMetricasGlobales();
  });

  document.getElementById('btnBuscar')?.addEventListener('click', ejecutarBusqueda);
  document.getElementById('buscarDNI')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); ejecutarBusqueda(); }
  });

  document.getElementById('btnNuevaEntrada')?.addEventListener('click', async () => {
    document.getElementById('formNuevaEntrada')?.classList.remove('hidden');
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      const input = document.getElementById('profesionalEntrada');
      if (user && input) input.value = obtenerNombreProfesional(user);
    } catch (err) { console.error(err); }
  });

  document.getElementById('btnCancelarEntrada')?.addEventListener('click', () => {
    document.getElementById('formNuevaEntrada')?.classList.add('hidden');
    resetInput('motivoEntrada');
    resetInput('observacionesEntrada');
    resetInput('dispositivoEntrada');
    resetInput('profesionalEntrada');
  });

  document.getElementById('btnGuardarEntrada')?.addEventListener('click', guardarNuevaEntrada);
  document.getElementById('btnExportarExcel')?.addEventListener('click', abrirModalExportarFicha);
  document.getElementById('btnExportarTodo')?.addEventListener('click', exportarBaseCompleta);
  document.getElementById('btnRefrescarAlertas')?.addEventListener('click', cargarAlertasSeguridad);
  document.getElementById('clinicalForm')?.addEventListener('submit', guardarHistoriaClinica);

  // Geolocalización
  document.getElementById('btnGeolocalizar')?.addEventListener('click', obtenerUbicacion);

  // Modales
  document.getElementById('btnCancelarExportModal')?.addEventListener('click', cerrarModalExportarFicha);
  document.getElementById('modalExportarBackdrop')?.addEventListener('click', cerrarModalExportarFicha);
  document.getElementById('btnConfirmarExportModal')?.addEventListener('click', confirmarExportarFicha);
  document.getElementById('exportMotivo')?.addEventListener('change', e => {
    const wrap = document.getElementById('exportMotivoOtroWrap');
    if (wrap) wrap.classList.toggle('hidden', e.target.value !== 'Otro');
  });

  document.getElementById('btnVerAuditoria')?.addEventListener('click', abrirModalAuditoria);
  document.getElementById('btnCerrarAuditoria')?.addEventListener('click', () => {
    document.getElementById('modalAuditoria')?.classList.add('hidden');
  });
  document.getElementById('modalAuditoriaBackdrop')?.addEventListener('click', () => {
    document.getElementById('modalAuditoria')?.classList.add('hidden');
  });
}

// --- GEOLOCALIZACIÓN ---
async function obtenerUbicacion() {
  const status = document.getElementById('geoStatus');
  if (!navigator.geolocation) {
    if (status) status.textContent = 'Tu navegador no soporta geolocalización.';
    return;
  }

  if (status) status.textContent = 'Obteniendo ubicación...';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      document.getElementById('latitud').value = lat.toFixed(7);
      document.getElementById('longitud').value = lon.toFixed(7);

      if (status) status.textContent = `Ubicación capturada ✓ (${lat.toFixed(5)}, ${lon.toFixed(5)})`;

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
          { headers: { 'Accept-Language': 'es' } }
        );
        const data = await res.json();
        if (data.address) {
          const barrio = data.address.suburb || data.address.neighbourhood || data.address.quarter || data.address.residential || '';
          if (barrio && document.getElementById('barrioResidencia')) {
            document.getElementById('barrioResidencia').value = barrio;
          }
        }
      } catch (e) {
        console.warn('Geocodificación inversa no disponible', e);
      }
    },
    (err) => {
      if (status) status.textContent = 'No se pudo obtener la ubicación: ' + err.message;
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

async function manejarLogin(e) {
  e.preventDefault();
  const loginError = document.getElementById('loginError');
  if (loginError) loginError.classList.add('hidden');

  const email = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  const rememberMe = document.getElementById('rememberMe')?.checked ?? false;

  if (!email || !password) return;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (data?.user) {
      if (rememberMe) {
        localStorage.setItem('mds_remember_me', '1');
        sessionStorage.removeItem('mds_session_active');
      } else {
        localStorage.removeItem('mds_remember_me');
        sessionStorage.setItem('mds_session_active', '1');
      }

      state.currentUser = data.user;
      await registrarActividad('LOGIN', 'Inicio de sesión exitoso');
      mostrarDashboard(data.user);
    }
  } catch (error) {
    if (loginError) {
      loginError.textContent = 'Error de autenticación: ' + (error.message || 'Credenciales inválidas');
      loginError.classList.remove('hidden');
    }
  }
}

// --- VISTAS ---
function toggleVisibilidadSecciones({ dashboard, formulario }) {
  const dash = document.getElementById('dashboardSection');
  const form = document.getElementById('formularioSection');
  if (dash) dash.classList.toggle('hidden', !dashboard);
  if (form) form.classList.toggle('hidden', !formulario);
}

function mostrarLogin() {
  document.getElementById('loginSection')?.classList.remove('hidden');
  document.getElementById('dashboardSection')?.classList.add('hidden');
  document.getElementById('formularioSection')?.classList.add('hidden');
  document.getElementById('detalleFichaPaciente')?.classList.add('hidden');
}

function mostrarDashboard(user) {
  document.getElementById('loginSection')?.classList.add('hidden');
  document.getElementById('formularioSection')?.classList.add('hidden');
  document.getElementById('dashboardSection')?.classList.remove('hidden');

  const userEmailText = document.getElementById('userEmail');
  if (userEmailText) userEmailText.textContent = obtenerNombreProfesional(user);

  limpiarVistaInicial();
  cargarMetricasGlobales();
  actualizarUIAdmin();
}

function obtenerNombreProfesional(user) {
  if (!user) return 'No especificado';
  const meta = user.user_metadata;
  if (meta?.apellido && meta?.nombre) return `${meta.apellido}, ${meta.nombre}`;
  if (meta?.nombre) return meta.nombre;
  return user.email || 'No especificado';
}

function limpiarVistaInicial() {
  const tbody = document.getElementById('tablaPacientesBody');
  const cards = document.getElementById('resultadoCardsMobile');
  const contador = document.getElementById('contadorResultados');
  const detalle = document.getElementById('detalleFichaPaciente');

  if (tbody) {
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'px-6 py-8 text-center text-xs text-slate-400';
    td.textContent = 'Ingrese un DNI o Nombre en el buscador y presione "Buscar" para ver resultados.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  if (cards) cards.innerHTML = '<p class="text-center text-xs text-slate-400 py-6">Ingrese un DNI o nombre y presione Buscar.</p>';
  if (contador) contador.textContent = '0 fichas mostradas';
  if (detalle) detalle.classList.add('hidden');
}

// --- MÉTRICAS Y SALA DE SITUACIÓN ---
async function cargarMetricasGlobales() {
  try {
    const [resTotal, resTratamiento, resSeguimiento, resEgreso, resReingreso, resEpi] = await Promise.all([
      supabaseClient.from('historias_clinicas').select('*', { count: 'exact', head: true }),
      supabaseClient.from('historias_clinicas').select('*', { count: 'exact', head: true }).or('estado_paciente.eq.en_tratamiento,estado_paciente.eq.En tratamiento,estado_paciente.is.null'),
      supabaseClient.from('historias_clinicas').select('*', { count: 'exact', head: true }).or('estado_paciente.eq.en_seguimiento,estado_paciente.eq.En seguimiento'),
      supabaseClient.from('historias_clinicas').select('*', { count: 'exact', head: true }).or('estado_paciente.eq.egreso,estado_paciente.eq.Egreso'),
      supabaseClient.from('historias_clinicas').select('*', { count: 'exact', head: true }).or('estado_paciente.eq.reingreso,estado_paciente.eq.Reingreso'),
      supabaseClient.from('historias_clinicas').select('policonsumo, atencion_guardia, triaje_nivel')
    ]);

    const total = resTotal.count ?? 0;
    actualizarTexto('totalFichasActivas', total);
    actualizarTexto('cantTratamiento', resTratamiento.count ?? 0);
    actualizarTexto('cantSeguimiento', resSeguimiento.count ?? 0);
    actualizarTexto('cantEgreso', resEgreso.count ?? 0);
    actualizarTexto('cantReingreso', resReingreso.count ?? 0);

    if (resEpi.data && total > 0) {
      const registros = resEpi.data;
      
      const cantPoli = registros.filter(r => r.policonsumo === 'SI').length;
      const cantGuardia = registros.filter(r => 
        r.triaje_nivel === 'Urgencia (Guardia)' || r.triaje_nivel === 'Urgencia / Guardia General'
      ).length;
      const cantIcap = registros.filter(r => r.triaje_nivel === 'Atencion Ambulatoria (ICAP)').length;

      actualizarTexto('statPoliconsumo', `${Math.round((cantPoli / total) * 100)}%`);
      actualizarTexto('statGuardia', `${Math.round((cantGuardia / total) * 100)}%`);
      actualizarTexto('statIcap', `${Math.round((cantIcap / total) * 100)}%`);
    }
  } catch (err) {
    console.error('[MetricasError]', err);
  }
}

// --- BÚSQUEDA ---
async function ejecutarBusqueda() {
  const input = document.getElementById('buscarDNI');
  const tbody = document.getElementById('tablaPacientesBody');
  const cards = document.getElementById('resultadoCardsMobile');
  const contador = document.getElementById('contadorResultados');
  const raw = (input?.value || '').trim();
  const query = raw.replace(/[%_]/g, '').slice(0, 100);

  if (!query) {
    limpiarVistaInicial();
    cargarMetricasGlobales();
    return;
  }

  registrarActividad('BUSQUEDA', `Buscó término: "${query}"`);

  const msgCargando = 'Buscando registros...';
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-xs text-slate-400">${msgCargando}</td></tr>`;
  }
  if (cards) {
    cards.innerHTML = `<p class="text-center text-xs text-slate-400 py-6">${msgCargando}</p>`;
  }

  try {
    let consulta = supabaseClient.from('historias_clinicas').select('*').order('created_at', { ascending: false }).limit(SEARCH_LIMIT);
    if (/^\d{7,11}$/.test(query)) {
      consulta = consulta.eq('paciente_dni', query);
    } else {
      consulta = consulta.or(`paciente_nombre.ilike.%${query}%,paciente_apellido.ilike.%${query}%`);
    }

    const { data, error } = await consulta;
    if (error) throw error;

    const dnisVistos = new Set();
    const pacientesUnicos = (data || []).filter(p => {
      if (!p.paciente_dni) return true;
      if (dnisVistos.has(p.paciente_dni)) return false;
      dnisVistos.add(p.paciente_dni);
      return true;
    });

    if (contador) contador.textContent = `${pacientesUnicos.length} resultados`;
    renderTablaSegura(pacientesUnicos);

    document.getElementById('resultadoBusqueda')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('[BusquedaError]', err);
    const msgErr = 'Error al buscar historias clínicas.';
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-4 text-center text-xs text-red-500">${msgErr}</td></tr>`;
    }
    if (cards) {
      cards.innerHTML = `<p class="text-center text-xs text-red-500 py-4">${msgErr}</p>`;
    }
  }
}

function renderTablaSegura(registros) {
  const tbody = document.getElementById('tablaPacientesBody');
  const cards = document.getElementById('resultadoCardsMobile');
  if (tbody) tbody.innerHTML = '';
  if (cards) cards.innerHTML = '';

  if (!registros || registros.length === 0) {
    const msgVacio = 'No se encontraron fichas clínicas asociadas.';
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-xs text-amber-600">${msgVacio}</td></tr>`;
    }
    if (cards) {
      cards.innerHTML = `<p class="text-center text-xs text-amber-600 py-6">${msgVacio}</p>`;
    }
    return;
  }

  const fragmentTbody = document.createDocumentFragment();
  const fragmentCards = document.createDocumentFragment();

  registros.forEach(item => {
    const fecha = item.created_at ? new Date(item.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/I';
    const nombre = `${item.paciente_nombre || ''} ${item.paciente_apellido || ''}`.trim();
    const dni = item.paciente_dni || 'N/R';
    const tipoDoc = item.tipo_documento ? `${item.tipo_documento} ` : '';

    if (tbody) {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

      const tdDni = document.createElement('td');
      tdDni.className = 'px-4 lg:px-6 py-4 font-mono font-bold text-slate-900';
      tdDni.textContent = `${tipoDoc}${dni}`;

      const tdNombre = document.createElement('td');
      tdNombre.className = 'px-4 lg:px-6 py-4 font-semibold text-slate-800';
      tdNombre.textContent = nombre;

      const tdFecha = document.createElement('td');
      tdFecha.className = 'px-4 lg:px-6 py-4 font-mono text-xs text-slate-500';
      tdFecha.textContent = fecha;

      const tdEstado = document.createElement('td');
      tdEstado.className = 'px-4 lg:px-6 py-4';
      tdEstado.appendChild(crearBadgeEstado(item.estado_paciente));

      const tdAccion = document.createElement('td');
      tdAccion.className = 'px-4 lg:px-6 py-4 text-right';
      const btnVer = document.createElement('button');
      btnVer.type = 'button';
      btnVer.className = 'text-xs bg-sky-50 text-sky-700 font-bold px-3 py-1.5 rounded-lg border border-sky-200 hover:bg-sky-100 transition';
      btnVer.textContent = 'Ver Historial';
      btnVer.addEventListener('click', () => verFichaPaciente(item.id));
      tdAccion.appendChild(btnVer);

      tr.append(tdDni, tdNombre, tdFecha, tdEstado, tdAccion);
      fragmentTbody.appendChild(tr);
    }

    if (cards) {
      const card = document.createElement('div');
      card.className = 'bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3';

      const topRow = document.createElement('div');
      topRow.className = 'flex items-center justify-between border-b border-slate-100 pb-2';

      const dniSpan = document.createElement('span');
      dniSpan.className = 'font-mono font-bold text-sm text-slate-900';
      dniSpan.textContent = `${tipoDoc}${dni}`;

      topRow.appendChild(dniSpan);
      topRow.appendChild(crearBadgeEstado(item.estado_paciente));

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'space-y-1';

      const nombreP = document.createElement('p');
      nombreP.className = 'font-bold text-slate-800 text-base';
      nombreP.textContent = nombre || 'Sin nombre registrado';

      const fechaP = document.createElement('p');
      fechaP.className = 'text-xs font-mono text-slate-400';
      fechaP.textContent = `Fecha de alta: ${fecha}`;

      bodyDiv.append(nombreP, fechaP);

      const btnVerMobile = document.createElement('button');
      btnVerMobile.type = 'button';
      btnVerMobile.className = 'w-full text-center py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-lg shadow-sm transition active:scale-[0.98]';
      btnVerMobile.textContent = 'Ver Historial Completo';
      btnVerMobile.addEventListener('click', () => verFichaPaciente(item.id));

      card.append(topRow, bodyDiv, btnVerMobile);
      fragmentCards.appendChild(card);
    }
  });

  if (tbody) tbody.appendChild(fragmentTbody);
  if (cards) cards.appendChild(fragmentCards);
}

function crearBadgeEstado(estado) {
  const span = document.createElement('span');
  span.className = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border';
  const dot = document.createElement('span');
  dot.className = 'h-1.5 w-1.5 rounded-full';

  const est = (estado || '').toLowerCase();

  if (est.includes('seguimiento')) {
    span.classList.add('bg-slate-100', 'text-slate-700', 'border-slate-300');
    dot.classList.add('bg-slate-400');
    span.append(dot, document.createTextNode('En seguimiento'));
  } else if (est.includes('egreso')) {
    span.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-200');
    dot.classList.add('bg-amber-500');
    span.append(dot, document.createTextNode('Egreso'));
  } else if (est.includes('reingreso')) {
    span.classList.add('bg-sky-50', 'text-sky-700', 'border-sky-200');
    dot.classList.add('bg-sky-500');
    span.append(dot, document.createTextNode('Reingreso'));
  } else {
    span.classList.add('bg-emerald-50', 'text-emerald-700', 'border-emerald-200');
    dot.classList.add('bg-emerald-500');
    span.append(dot, document.createTextNode('En tratamiento'));
  }
  return span;
}

// --- DETALLE DE FICHA ---
async function verFichaPaciente(id) {
  try {
    const { data, error } = await supabaseClient.from('historias_clinicas').select('*').eq('id', id).single();
    if (error || !data) throw new Error('No se pudo cargar la ficha del paciente.');

    state.pacienteActual = data;

    registrarActividad('VER_FICHA', `Consultó ficha de ${data.paciente_nombre} ${data.paciente_apellido} (DNI ${data.paciente_dni})`);

    actualizarTexto('fichaDniHeader', `FICHA - ${data.tipo_documento || 'DOC'} ${data.paciente_dni || 'N/R'}`);
    actualizarTexto('fichaNombreHeader', `${data.paciente_nombre || ''} ${data.paciente_apellido || ''}`.trim());

    const badgeContainer = document.getElementById('fichaEstadoBadge');
    if (badgeContainer) {
      badgeContainer.innerHTML = '';
      badgeContainer.appendChild(crearBadgeEstado(data.estado_paciente));
    }

    const fechaInicio = new Date(data.created_at);
    const dias = Math.floor((new Date() - fechaInicio) / (1000 * 60 * 60 * 24));
    actualizarTexto('cantDiasFicha', dias >= 0 ? dias : 0);

    await cargarEvolucionesDesdeTabla(data.id);

    const detalle = document.getElementById('detalleFichaPaciente');
    if (detalle) {
      detalle.classList.remove('hidden');
      detalle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    alert(err.message || 'Error al cargar la ficha.');
  }
}

async function cargarEvolucionesDesdeTabla(historiaId) {
  const contenedor = document.getElementById('timelineContenedor');
  if (!contenedor) return;

  contenedor.innerHTML = '<p class="text-xs text-slate-400">Cargando historial...</p>';

  try {
    const { data: entradas, error } = await supabaseClient
      .from('evoluciones')
      .select('*')
      .eq('historia_id', historiaId)
      .order('fecha', { ascending: true });

    if (error) throw error;

    let totalIngresos = 0;
    let totalEvoluciones = 0;
    contenedor.innerHTML = '';
    const fragment = document.createDocumentFragment();

    (entradas || []).forEach(item => {
      const tipoLower = (item.tipo || '').toLowerCase();
      if (tipoLower.includes('ingreso')) totalIngresos++;
      else totalEvoluciones++;

      const fechaFormateada = item.fecha
        ? new Date(item.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'N/I';

      const entryDiv = document.createElement('div');
      entryDiv.className = 'relative pl-2';

      const dot = document.createElement('span');
      dot.className = 'absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-sky-500 ring-4 ring-white';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'flex items-center gap-2 flex-wrap';

      const tipoSpan = document.createElement('span');
      tipoSpan.className = 'font-bold text-xs uppercase tracking-wider text-sky-800';
      tipoSpan.textContent = item.tipo || 'Evolución';

      const fechaSpan = document.createElement('span');
      fechaSpan.className = 'font-mono text-xs text-slate-400';
      fechaSpan.textContent = `• ${fechaFormateada}`;

      const metaSpan = document.createElement('span');
      metaSpan.className = 'text-xs text-slate-500 font-mono';
      const disp = item.dispositivo ? ` | Disp: ${item.dispositivo}` : '';
      const prof = item.profesional ? ` | Usuario: ${item.profesional}` : '';
      metaSpan.textContent = `${disp}${prof}`;

      headerDiv.append(tipoSpan, fechaSpan, metaSpan);

      const descP = document.createElement('p');
      descP.className = 'text-sm text-slate-700 mt-1 font-medium';
      descP.textContent = item.motivo || 'Sin detalles';

      entryDiv.append(dot, headerDiv, descP);

      if (item.observaciones) {
        const obsP = document.createElement('p');
        obsP.className = 'text-xs text-slate-500 mt-1 italic';
        obsP.textContent = `Observaciones: ${item.observaciones}`;
        entryDiv.appendChild(obsP);
      }

      fragment.appendChild(entryDiv);
    });

    actualizarTexto('cantIngresosFicha', totalIngresos);
    actualizarTexto('cantEvolucionesFicha', totalEvoluciones);
    contenedor.appendChild(fragment);
  } catch (err) {
    console.error('[Evoluciones]', err);
    contenedor.innerHTML = '<p class="text-red-500 text-xs">Error al cargar el historial.</p>';
  }
}

// --- GUARDAR NUEVA EVOLUCIÓN UNIFICADA ---
async function guardarNuevaEntrada() {
  const motivo = document.getElementById('motivoEntrada')?.value?.trim();
  if (!motivo) {
    alert('Por favor complete la descripción de la evolución.');
    return;
  }
  if (!state.pacienteActual?.id) return;

  const tipoEvento = document.getElementById('tipoEntrada')?.value || 'En tratamiento';

  const nuevaEntrada = {
    historia_id: state.pacienteActual.id,
    tipo: tipoEvento,
    fecha: new Date().toISOString(),
    motivo: motivo,
    observaciones: document.getElementById('observacionesEntrada')?.value?.trim() || null,
    dispositivo: document.getElementById('dispositivoEntrada')?.value?.trim() || 'No especificado',
    profesional: document.getElementById('profesionalEntrada')?.value?.trim() || 'No especificado',
    created_by: state.currentUser?.id || null
  };

  try {
    // 1. Insertar nota de evolución en la línea de tiempo
    const { error: errEntrada } = await supabaseClient.from('evoluciones').insert([nuevaEntrada]);
    if (errEntrada) throw errEntrada;

    // 2. Mapear estado para sincronizar la ficha principal
    let estadoBaseDatos = 'en_tratamiento';
    if (tipoEvento === 'En seguimiento') estadoBaseDatos = 'en_seguimiento';
    if (tipoEvento === 'Egreso') estadoBaseDatos = 'egreso';
    if (tipoEvento === 'Reingreso') estadoBaseDatos = 'reingreso';

    // 3. Actualizar la tabla de Historias Clínicas
    await supabaseClient
      .from('historias_clinicas')
      .update({ estado_paciente: estadoBaseDatos })
      .eq('id', state.pacienteActual.id);

    state.pacienteActual.estado_paciente = estadoBaseDatos;

    registrarActividad('NUEVA_EVOLUCION', `Registró "${tipoEvento}" en DNI ${state.pacienteActual.paciente_dni}`);

    resetInput('motivoEntrada');
    resetInput('observacionesEntrada');
    resetInput('dispositivoEntrada');
    resetInput('profesionalEntrada');
    document.getElementById('formNuevaEntrada')?.classList.add('hidden');

    await verFichaPaciente(state.pacienteActual.id);
    cargarMetricasGlobales();

  } catch (err) {
    alert('Error al guardar la evolución: ' + (err.message || 'Error desconocido'));
  }
}

// --- EXPORTACIÓN PDF ---
function abrirModalExportarFicha() {
  if (!state.pacienteActual) {
    alert('No hay ninguna ficha activa para exportar.');
    return;
  }
  document.getElementById('modalExportarFicha')?.classList.remove('hidden');
}

function cerrarModalExportarFicha() {
  document.getElementById('modalExportarFicha')?.classList.add('hidden');
  const errEl = document.getElementById('exportModalError');
  if (errEl) errEl.classList.add('hidden');
}

function fmt(v) {
  if (v == null || v === '') return '—';
  return String(v);
}

function labelEstado(est) {
  const e = (est || '').toLowerCase();
  if (e.includes('seguimiento')) return 'En seguimiento';
  if (e.includes('egreso')) return 'Egreso';
  if (e.includes('reingreso')) return 'Reingreso';
  return 'En tratamiento';
}

async function confirmarExportarFicha() {
  if (!state.pacienteActual || !state.currentUser) return;

  const motivoSelect = document.getElementById('exportMotivo')?.value;
  const motivoOtro = document.getElementById('exportMotivoOtro')?.value?.trim();
  const motivo = motivoSelect === 'Otro' ? (motivoOtro || 'Otro') : motivoSelect;

  if (!motivo) {
    const errEl = document.getElementById('exportModalError');
    if (errEl) {
      errEl.textContent = 'Debe indicar el motivo de la exportación.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  const p = state.pacienteActual;
  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    alert('No se pudo cargar la librería PDF. Recargue la página e intente nuevamente.');
    return;
  }

  let evoluciones = [];
  try {
    const { data } = await supabaseClient
      .from('evoluciones')
      .select('*')
      .eq('historia_id', p.id)
      .order('fecha', { ascending: true });
    evoluciones = data || [];
  } catch (e) {
    console.warn('[ExportPDF] No se pudieron cargar evoluciones', e);
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;

  const addTitle = (text, size = 14) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(15, 23, 42);
    doc.text(text, margin, y);
    y += size * 0.5 + 2;
  };

  const addSection = (title) => {
    if (y > 270) { doc.addPage(); y = 16; }
    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y - 4, pageW - margin * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 64, 175);
    doc.text(title, margin + 2, y);
    y += 8;
  };

  const addRow = (label, value) => {
    if (y > 280) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(label + ':', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    const valStr = fmt(value);
    const lines = doc.splitTextToSize(valStr, pageW - margin * 2 - 55);
    doc.text(lines, margin + 55, y);
    y += Math.max(5, lines.length * 4);
  };

  addTitle('REGISTRO ÚNICO DEL PACIENTE', 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('DAT – MDS - Corrientes  |  Dirección de Asistencia y Tratamiento', margin, y);
  y += 5;
  doc.setFontSize(8);
  doc.text(`Exportado: ${new Date().toLocaleString('es-AR')}  |  Motivo: ${motivo}  |  Por: ${obtenerNombreProfesional(state.currentUser)}`, margin, y);
  y += 8;
  doc.setDrawColor(148, 163, 184);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  addSection('1. Identificación');
  addRow('Documento', `${fmt(p.tipo_documento)} ${fmt(p.paciente_dni)}`);
  addRow('Nombre completo', `${fmt(p.paciente_nombre)} ${fmt(p.paciente_apellido)}`);
  addRow('Teléfono', p.paciente_telefono);
  addRow('Email', p.paciente_email);
  addRow('Género', p.sexo);
  addRow('Fecha nac. / Edad', `${fmt(p.fecha_nacimiento)}  |  ${fmt(p.edad)} años  |  ${fmt(p.grupo_etario)}`);
  addRow('Estado actual', labelEstado(p.estado_paciente));

  addSection('0. Triaje ICAP / Criterios de Admisión');
  addRow('Nivel de Triaje', p.triaje_nivel);
  addRow('Patología Dual', p.patologia_dual);
  addRow('Riesgo Inminente', p.riesgo_inminente);
  addRow('Profesional', p.nombre_profesional);
  addRow('M.P.', p.mp_profesional);

  addSection('Dirección y situación habitacional');
  addRow('Calle y N°', `${fmt(p.calle)} ${fmt(p.numero_calle)}  Piso: ${fmt(p.piso)}  Depto: ${fmt(p.depto)}`);
  addRow('Barrio / Localidad', `${fmt(p.barrio_residencia)}  |  ${fmt(p.localidad)}`);
  addRow('Depto / Provincia', `${fmt(p.departamento_partido)}  |  ${fmt(p.provincia)}`);
  addRow('Situación habitacional', p.situacion_habitacional);
  addRow('Habitaciones / Personas', `${fmt(p.habitaciones_dormir)} hab.  |  ${fmt(p.personas_vivienda)} personas`);
  addRow('Agua / Excretas', `${fmt(p.servicio_agua)}  |  ${fmt(p.eliminacion_excretas)}`);
  addRow('Geolocalización', p.latitud && p.longitud ? `${p.latitud}, ${p.longitud}` : null);

  addSection('Sociodemografía y salud');
  addRow('Nivel educativo', p.nivel_educativo);
  addRow('Situación laboral', p.situacion_laboral);
  addRow('Cobertura de salud', p.cobertura_salud);
  addRow('Discapacidad', `${fmt(p.discapacidad)}  ${p.observaciones_discapacidad ? '| ' + p.observaciones_discapacidad : ''}`);
  addRow('Dispositivo de captura', p.dispositivo_captura);

  addSection('2. Patrones de consumo');
  addRow('Sustancia principal', p.sustancia_consumida);
  addRow('Vía de administración', p.via_administracion);
  addRow('Edad / Fecha inicio', `${fmt(p.edad_inicio)} años  |  ${fmt(p.fecha_inicio_consumo)}`);
  addRow('Frecuencia', p.frecuencia_uso);
  addRow('Policonsumo', p.policonsumo);
  addRow('Sustancias secundarias', p.sustancias_secundarias);

  addSection('3. Contexto y cuidados');
  addRow('Lugar de consumo', p.lugar_consumo);
  addRow('Red de acompañamiento', p.red_acompanamiento);
  addRow('Motivo / detonante', p.motivos);
  addRow('Pautas de autocuidado', p.pautas_autocuidado);

  addSection('4. Asistencia y red territorial');
  addRow('Tratamientos previos', p.consultas_previas);
  addRow('Atención en guardia', p.atencion_guardia);
  addRow('Atención salud mental', p.atencion_salud_mental);
  addRow('Internaciones previas', p.internaciones);
  addRow('Vinculación a red', p.vinculacion_red);
  addRow('Motivo Primer Consulta/Encuentro', p.motivo_consulta);
  addRow('Primer Observación', p.observaciones);

  addSection(`Historial de Evolución (${evoluciones.length})`);
  if (evoluciones.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Sin entradas registradas.', margin, y);
    y += 6;
  } else {
    evoluciones.forEach((ev, idx) => {
      if (y > 265) { doc.addPage(); y = 16; }
      const fechaEv = ev.fecha
        ? new Date(ev.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(14, 116, 144);
      doc.text(`${idx + 1}. ${fmt(ev.tipo).toUpperCase()}  ·  ${fechaEv}`, margin, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(8);
      const motivoLines = doc.splitTextToSize(`Motivo: ${fmt(ev.motivo)}`, pageW - margin * 2 - 4);
      doc.text(motivoLines, margin + 2, y);
      y += motivoLines.length * 3.8;
      if (ev.observaciones) {
        const obsLines = doc.splitTextToSize(`Observaciones: ${ev.observaciones}`, pageW - margin * 2 - 4);
        doc.setTextColor(100, 116, 139);
        doc.text(obsLines, margin + 2, y);
        y += obsLines.length * 3.8;
      }
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(7);
      doc.text(`Disp: ${fmt(ev.dispositivo)}  |  Profesional: ${fmt(ev.profesional)}`, margin + 2, y);
      y += 6;
    });
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Confidencial – Ley 26.657  |  Página ${i} de ${totalPages}  |  DAT-MDS Corrientes`,
      margin,
      doc.internal.pageSize.getHeight() - 8
    );
  }

  const fileName = `RUP_${p.paciente_dni || 'SIN_DNI'}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);

  registrarActividad('EXPORTAR_FICHA', `Exportó PDF de ficha DNI ${p.paciente_dni}. Motivo: ${motivo}`);

  try {
    await supabaseClient.from('export_audit_log').insert([{
      user_id: state.currentUser.id,
      user_email: state.currentUser.email,
      user_name: obtenerNombreProfesional(state.currentUser),
      tipo: 'ficha_individual',
      paciente_dni: p.paciente_dni,
      motivo,
      metadata: { alerta_seguridad: false, formato: 'pdf', cantidad_evoluciones: evoluciones.length }
    }]);
  } catch (e) { console.warn(e); }

  cerrarModalExportarFicha();
}

async function exportarBaseCompleta() {
  if (!esAdministrador(state.currentUser)) return;
  try {
    const { data, error } = await supabaseClient.from('historias_clinicas').select('*');
    if (error) throw error;

    const worksheet = XLSX.utils.json_to_sheet(data || []);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Base Epidemiológica');
    XLSX.writeFile(workbook, `Base_Epidemiologica_MDS_${new Date().toISOString().slice(0, 10)}.xlsx`);

    registrarActividad('EXPORTAR_BASE_COMPLETA', `Exportó la base epidemiológica completa (${data?.length || 0} registros)`);

    await supabaseClient.from('export_audit_log').insert([{
      user_id: state.currentUser.id,
      user_email: state.currentUser.email,
      user_name: obtenerNombreProfesional(state.currentUser),
      tipo: 'base_completa',
      motivo: 'Exportación masiva administrativa',
      metadata: { alerta_seguridad: true, cantidad_registros: (data || []).length, alerta_motivo: 'Exportación de base completa' }
    }]);
  } catch (err) {
    alert('Error al exportar la base completa.');
  }
}

// --- GUARDAR HISTORIA CLÍNICA (CREACIÓN DE FICHA) ---
function asegurarBotonEditarFicha() {
  const btnNueva = document.getElementById('btnNuevaEntrada');
  if (!btnNueva || document.getElementById('btnVerFichaCompleta')) return;

  const btn = document.createElement('button');
  btn.id = 'btnVerFichaCompleta';
  btn.type = 'button';
  btn.className = 'text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100 transition mr-2';
  btn.textContent = 'Ver / Editar Ficha';
  btnNueva.parentNode?.insertBefore(btn, btnNueva);
  btn.addEventListener('click', cargarFichaParaEditar);
}

function cargarFichaParaEditar() {
  if (!state.pacienteActual) return;
  toggleVisibilidadSecciones({ dashboard: false, formulario: true });

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  };

  const p = state.pacienteActual;
  setVal('triajeNivel', p.triaje_nivel);
  setVal('patologiaDual', p.patologia_dual);
  setVal('riesgoInminente', p.riesgo_inminente);
  setVal('nombreProfesional', p.nombre_profesional);
  setVal('mpProfesional', p.mp_profesional);
  setVal('tipoDocumento', p.tipo_documento);
  setVal('pacienteDni', p.paciente_dni);
  setVal('pacienteNombre', p.paciente_nombre);
  setVal('pacienteApellido', p.paciente_apellido);
  setVal('pacienteTelefono', p.paciente_telefono);
  setVal('pacienteEmail', p.paciente_email);
  setVal('sexo', p.sexo);
  setVal('fechaNacimiento', p.fecha_nacimiento);
  setVal('edad', p.edad);
  setVal('grupoEtario', p.grupo_etario);
  setVal('calle', p.calle);
  setVal('numeroCalle', p.numero_calle);
  setVal('piso', p.piso);
  setVal('depto', p.depto);
  setVal('barrioResidencia', p.barrio_residencia);
  setVal('localidad', p.localidad);
  setVal('departamentoPartido', p.departamento_partido);
  setVal('provincia', p.provincia || 'Corrientes');
  setVal('situacionHabitacional', p.situacion_habitacional);
  setVal('habitacionesDormir', p.habitaciones_dormir);
  setVal('personasVivienda', p.personas_vivienda);
  setVal('servicioAgua', p.servicio_agua);
  setVal('eliminacionExcretas', p.eliminacion_excretas);
  setVal('nivelEducativo', p.nivel_educativo);
  setVal('situacionLaboral', p.situacion_laboral);
  setVal('coberturaSalud', p.cobertura_salud);
  setVal('discapacidad', p.discapacidad);
  setVal('observacionesDiscapacidad', p.observaciones_discapacidad);
  setVal('dispositivoCaptura', p.dispositivo_captura);
  setVal('sustanciaConsumida', p.sustancia_consumida);
  setVal('viaAdministracion', p.via_administracion);
  setVal('edadInicio', p.edad_inicio);
  setVal('fechaInicioConsumo', p.fecha_inicio_consumo);
  setVal('frecuenciaUso', p.frecuencia_uso);
  setVal('policonsumo', p.policonsumo);
  setVal('sustanciasSecundarias', p.sustancias_secundarias);
  setVal('lugarConsumo', p.lugar_consumo);
  setVal('redAcompanamiento', p.red_acompanamiento);
  setVal('motivos', p.motivos);
  setVal('pautasAutocuidado', p.pautas_autocuidado);
  setVal('consultasPrevias', p.consultas_previas);
  setVal('atencionGuardia', p.atencion_guardia);
  setVal('atencionSaludMental', p.atencion_salud_mental);
  setVal('internaciones', p.internaciones);
  setVal('vinculacionRed', p.vinculacion_red);
  setVal('motivoConsulta', p.motivo_consulta);
  setVal('observaciones', p.observaciones);
  setVal('latitud', p.latitud);
  setVal('longitud', p.longitud);

  const motivoEl = document.getElementById('motivoConsulta');
  const obsEl = document.getElementById('observaciones');
  if (motivoEl) {
    const tieneMotivo = !!(p.motivo_consulta && String(p.motivo_consulta).trim());
    motivoEl.readOnly = tieneMotivo;
    motivoEl.classList.toggle('bg-slate-100', tieneMotivo);
    motivoEl.classList.toggle('cursor-not-allowed', tieneMotivo);
  }
  if (obsEl) {
    const tieneObs = !!(p.observaciones && String(p.observaciones).trim());
    obsEl.readOnly = tieneObs;
    obsEl.classList.toggle('bg-slate-100', tieneObs);
    obsEl.classList.toggle('cursor-not-allowed', tieneObs);
  }

  const geoStatus = document.getElementById('geoStatus');
  if (geoStatus && p.latitud && p.longitud) {
    geoStatus.textContent = `Ubicación guardada: ${p.latitud}, ${p.longitud}`;
  }
}

async function guardarHistoriaClinica(e) {
  e.preventDefault();
  const clinicalStatus = document.getElementById('clinicalStatus');

  const getVal = (id) => {
    const val = document.getElementById(id)?.value?.trim();
    return val === '' ? null : val;
  };

  const payload = {
    medico_id: state.currentUser.id,
    triaje_nivel: getVal('triajeNivel'),
    patologia_dual: getVal('patologiaDual'),
    riesgo_inminente: getVal('riesgoInminente'),
    nombre_profesional: getVal('nombreProfesional'),
    mp_profesional: getVal('mpProfesional'),
    tipo_documento: getVal('tipoDocumento'),
    paciente_dni: getVal('pacienteDni'),
    paciente_nombre: getVal('pacienteNombre'),
    paciente_apellido: getVal('pacienteApellido'),
    paciente_telefono: getVal('pacienteTelefono'),
    paciente_email: getVal('pacienteEmail'),
    estado_paciente: 'en_tratamiento', // Alta inicial asigna En Tratamiento por defecto
    sexo: getVal('sexo'),
    fecha_nacimiento: getVal('fechaNacimiento'),
    edad: getVal('edad') ? parseInt(getVal('edad'), 10) : null,
    grupo_etario: getVal('grupoEtario'),
    calle: getVal('calle'),
    numero_calle: getVal('numeroCalle'),
    piso: getVal('piso'),
    depto: getVal('depto'),
    barrio_residencia: getVal('barrioResidencia'),
    localidad: getVal('localidad'),
    departamento_partido: getVal('departamentoPartido'),
    provincia: getVal('provincia') || 'Corrientes',
    situacion_habitacional: getVal('situacionHabitacional'),
    habitaciones_dormir: getVal('habitacionesDormir') ? parseInt(getVal('habitacionesDormir'), 10) : null,
    personas_vivienda: getVal('personasVivienda') ? parseInt(getVal('personasVivienda'), 10) : null,
    servicio_agua: getVal('servicioAgua'),
    eliminacion_excretas: getVal('eliminacionExcretas'),
    nivel_educativo: getVal('nivelEducativo'),
    situacion_laboral: getVal('situacionLaboral'),
    cobertura_salud: getVal('coberturaSalud'),
    discapacidad: getVal('discapacidad'),
    observaciones_discapacidad: getVal('observacionesDiscapacidad'),
    dispositivo_captura: getVal('dispositivoCaptura'),
    sustancia_consumida: getVal('sustanciaConsumida'),
    via_administracion: getVal('viaAdministracion'),
    edad_inicio: getVal('edadInicio') ? parseInt(getVal('edadInicio'), 10) : null,
    fecha_inicio_consumo: getVal('fechaInicioConsumo'),
    frecuencia_uso: getVal('frecuenciaUso'),
    policonsumo: getVal('policonsumo'),
    sustancias_secundarias: getVal('sustanciasSecundarias'),
    lugar_consumo: getVal('lugarConsumo'),
    red_acompanamiento: getVal('redAcompanamiento'),
    motivos: getVal('motivos'),
    pautas_autocuidado: getVal('pautasAutocuidado'),
    consultas_previas: getVal('consultasPrevias'),
    atencion_guardia: getVal('atencionGuardia'),
    atencion_salud_mental: getVal('atencionSaludMental'),
    internaciones: getVal('internaciones'),
    vinculacion_red: getVal('vinculacionRed'),
    motivo_consulta: getVal('motivoConsulta'),
    observaciones: getVal('observaciones'),
    latitud: getVal('latitud') ? parseFloat(getVal('latitud')) : null,
    longitud: getVal('longitud') ? parseFloat(getVal('longitud')) : null
  };

  try {
    let historiaId = state.pacienteActual?.id;

    if (historiaId) {
      delete payload.estado_paciente; // Mantener el estado actual al editar datos sociodemográficos
      const { error } = await supabaseClient.from('historias_clinicas').update(payload).eq('id', historiaId);
      if (error) throw error;
      registrarActividad('EDITAR_FICHA', `Editó ficha DNI ${payload.paciente_dni}`);
    } else {
      const { data, error } = await supabaseClient.from('historias_clinicas').insert([payload]).select('id').single();
      if (error) throw error;
      historiaId = data.id;

      registrarActividad('CREAR_FICHA', `Creó ficha inicial DNI ${payload.paciente_dni}`);

      // Registrar automáticamente la entrada de "Ingreso" inicial en la línea de tiempo
      await supabaseClient.from('evoluciones').insert([{
        historia_id: historiaId,
        tipo: 'Ingreso',
        fecha: new Date().toISOString(),
        motivo: payload.motivo_consulta || 'Ingreso registrado en el sistema.',
        observaciones: payload.observaciones || null,
        dispositivo: payload.dispositivo_captura || 'Admisión',
        profesional: obtenerNombreProfesional(state.currentUser),
        created_by: state.currentUser.id
      }]);
    }

    if (clinicalStatus) {
      clinicalStatus.textContent = '¡Historia clínica guardada con éxito!';
      clinicalStatus.className = 'text-sm mt-3 text-center text-emerald-600 font-bold block';
      clinicalStatus.classList.remove('hidden');
    }

    setTimeout(() => {
      toggleVisibilidadSecciones({ dashboard: true, formulario: false });
      limpiarVistaInicial();
      cargarMetricasGlobales();
    }, 1200);
  } catch (err) {
    if (clinicalStatus) {
      clinicalStatus.textContent = 'Error al guardar: ' + (err.message || 'Error desconocido');
      clinicalStatus.className = 'text-sm mt-3 text-center text-red-500 font-semibold block';
      clinicalStatus.classList.remove('hidden');
    }
  }
}

// --- AUDITORÍA DE USUARIOS ---
async function abrirModalAuditoria() {
  if (!esAdministrador(state.currentUser)) return;
  const modal = document.getElementById('modalAuditoria');
  const lista = document.getElementById('listaAuditoria');
  modal?.classList.remove('hidden');
  lista.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">Cargando registros de actividad...</p>';

  try {
    const { data, error } = await supabaseClient
      .from('user_activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    if (!data || data.length === 0) {
      lista.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">No hay actividades registradas aún.</p>';
      return;
    }

    lista.innerHTML = '';
    data.forEach(row => {
      const fecha = new Date(row.created_at).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const div = document.createElement('div');
      div.className = 'p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between items-center gap-4';

      const left = document.createElement('div');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'font-bold text-slate-900';
      nameSpan.textContent = row.user_name || row.user_email || '—';

      const accionSpan = document.createElement('span');
      accionSpan.className = 'ml-2 font-mono px-2 py-0.5 rounded text-[10px] bg-sky-100 text-sky-800 font-bold';
      accionSpan.textContent = row.accion || '';

      const detalleP = document.createElement('p');
      detalleP.className = 'text-slate-600 mt-1';
      detalleP.textContent = row.detalle || '';

      left.append(nameSpan, accionSpan, detalleP);

      const fechaSpan = document.createElement('span');
      fechaSpan.className = 'font-mono text-slate-400 whitespace-nowrap text-[11px]';
      fechaSpan.textContent = fecha;

      div.append(left, fechaSpan);
      lista.appendChild(div);
    });
  } catch (err) {
    lista.textContent = '';
    const errP = document.createElement('p');
    errP.className = 'text-center text-red-500 text-sm py-4';
    errP.textContent = 'Error al cargar actividad: ' + (err.message || '');
    lista.appendChild(errP);
  }
}

// --- UTILIDADES ---
function actualizarTexto(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

function resetInput(id) {
  const el = document.getElementById(id);
  if (el) el.value = '';
}
