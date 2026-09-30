/**
 * Ficha Clínica y Sala de Situación Epidemiológica
 * Dirección de Asistencia y Tratamiento (MDS Corrientes)
 */

// --- CONFIGURACIÓN ---
const SUPABASE_URL = window.ENV?.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[Config] Faltan SUPABASE_URL / SUPABASE_ANON_KEY. ' +
    'Defina window.ENV antes de cargar app.js.'
  );
}

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/** Estado centralizado */
const state = {
  pacienteActual: null,
  currentUser: null
};

const SEARCH_LIMIT = 50;

/** Emails administradores */
const ADMIN_EMAILS = [
  'armandojara07@gmail.com',
  'laurandreabenitez@gmail.com'
];

// --- INICIALIZACIÓN ---
window.addEventListener('DOMContentLoaded', async () => {
  inicializarEventos();

  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    if (session?.user) {
      state.currentUser = session.user;
      mostrarDashboard(session.user);
    } else {
      mostrarLogin();
    }
  } catch (err) {
    console.error('[AuthError] Error al obtener la sesión:', err);
    mostrarLogin();
  }

  asegurarBotonEditarFicha();
});

// --- ROLES ---
function esAdministrador(user) {
  if (!user?.email) return false;
  if (ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(user.email.toLowerCase())) {
    return true;
  }
  if (user.user_metadata?.role === 'admin') return true;
  return false;
}

function actualizarUIAdmin() {
  const cont = document.getElementById('adminActions');
  if (!cont) return;
  const esAdmin = esAdministrador(state.currentUser);
  cont.classList.toggle('hidden', !esAdmin);
  if (esAdmin) {
    cargarAlertasSeguridad();
  }
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

    const alertas = (data || []).filter((row) => {
      const meta = row.metadata || {};
      return meta.alerta_seguridad === true || meta.alerta_seguridad === 'true';
    });

    if (badge) badge.textContent = String(alertas.length);

    if (alertas.length === 0) {
      lista.innerHTML =
        '<p class="text-emerald-700 text-center py-3 font-medium">Sin alertas de seguridad recientes.</p>';
      return;
    }

    lista.innerHTML = '';
    const fragment = document.createDocumentFragment();

    alertas.forEach((row) => {
      const meta = row.metadata || {};
      const fecha = row.created_at
        ? new Date(row.created_at).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : '—';

      const tipoLabel =
        row.tipo === 'base_completa' ? 'Exportación masiva' : 'Ficha individual';
      const quien = row.user_name || row.user_email || 'Usuario desconocido';
      const motivo = row.motivo || 'Sin motivo';
      const motivoAlerta = meta.alerta_motivo || (meta.fuera_de_horario ? 'Fuera de horario habitual' : 'Alerta registrada');
      const cantidad = meta.cantidad_registros != null ? ` · ${meta.cantidad_registros} registros` : '';
      const dni = row.paciente_dni ? ` · DNI ${row.paciente_dni}` : '';

      const card = document.createElement('div');
      card.className =
        'rounded-xl border border-amber-200 bg-white px-3 py-2.5 shadow-sm';

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
  document.addEventListener('contextmenu', (e) => {
    const enZona = zonasProtegidas.some((id) => {
      const el = document.getElementById(id);
      return el && el.contains(e.target);
    });
    if (enZona) {
      e.preventDefault();
    }
  });

  document.addEventListener('keydown', (e) => {
    const key = e.key?.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'x' || key === 'a')) {
      const sel = window.getSelection?.()?.toString();
      if (sel && zonasProtegidas.some((id) => {
        const el = document.getElementById(id);
        return el && el.contains(window.getSelection()?.anchorNode);
      })) {
        e.preventDefault();
      }
    }
  });

  document.getElementById('loginForm')?.addEventListener('submit', manejarLogin);

  document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await supabaseClient.auth.signOut();
    } catch (err) {
      console.error('[AuthError] Error al cerrar sesión:', err);
    } finally {
      state.pacienteActual = null;
      state.currentUser = null;
      mostrarLogin();
      location.reload();
    }
  });

  document.getElementById('btnNuevaFicha')?.addEventListener('click', () => {
    state.pacienteActual = null;
    toggleVisibilidadSecciones({ dashboard: false, formulario: true });
    document.getElementById('clinicalForm')?.reset();
    const status = document.getElementById('clinicalStatus');
    if (status) status.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('btnVolverDashboard')?.addEventListener('click', () => {
    toggleVisibilidadSecciones({ dashboard: true, formulario: false });
    limpiarVistaInicial();
    cargarMetricasGlobales();
  });

  document.getElementById('btnBuscar')?.addEventListener('click', ejecutarBusqueda);

  document.getElementById('buscarDNI')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ejecutarBusqueda();
    }
  });

  document.getElementById('btnNuevaEntrada')?.addEventListener('click', async () => {
    document.getElementById('formNuevaEntrada')?.classList.remove('hidden');
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      const input = document.getElementById('profesionalEntrada');
      if (user && input) input.value = obtenerNombreProfesional(user);
    } catch (err) {
      console.error('[UserError] No se pudo obtener el profesional:', err);
    }
  });

  document.getElementById('btnCancelarEntrada')?.addEventListener('click', () => {
    document.getElementById('formNuevaEntrada')?.classList.add('hidden');
    resetInput('motivoEntrada');
    resetInput('dispositivoEntrada');
    resetInput('profesionalEntrada');
  });

  document.getElementById('btnGuardarEntrada')?.addEventListener('click', guardarNuevaEntrada);
  document.getElementById('cambioEstadoRapido')?.addEventListener('change', actualizarEstadoRapido);
  document.getElementById('btnExportarExcel')?.addEventListener('click', abrirModalExportarFicha);
  document.getElementById('btnExportarTodo')?.addEventListener('click', exportarBaseCompleta);
  document.getElementById('btnRefrescarAlertas')?.addEventListener('click', cargarAlertasSeguridad);
  document.getElementById('clinicalForm')?.addEventListener('submit', guardarHistoriaClinica);

  // Modal exportación
  document.getElementById('btnCancelarExportModal')?.addEventListener('click', cerrarModalExportarFicha);
  document.getElementById('modalExportarBackdrop')?.addEventListener('click', cerrarModalExportarFicha);
  document.getElementById('btnConfirmarExportModal')?.addEventListener('click', confirmarExportarFicha);
  document.getElementById('exportMotivo')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('exportMotivoOtroWrap');
    if (wrap) wrap.classList.toggle('hidden', e.target.value !== 'Otro');
  });
}

async function manejarLogin(e) {
  e.preventDefault();
  const loginError = document.getElementById('loginError');
  if (loginError) loginError.classList.add('hidden');

  const email = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;

  if (!email || !password) return;

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    if (data?.user) {
      state.currentUser = data.user;
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

  if (cards) {
    cards.innerHTML =
      '<p class="text-center text-xs text-slate-400 py-6">Ingrese un DNI o nombre y presione Buscar.</p>';
  }

  if (contador) contador.textContent = '0 fichas mostradas';
  if (detalle) detalle.classList.add('hidden');
}

// --- MÉTRICAS Y SALA DE SITUACIÓN EPIDEMIOLÓGICA ---
async function cargarMetricasGlobales() {
  try {
    const [resTotal, resTratamiento, resSeguimiento, resEgreso, resEpi] = await Promise.all([
      supabaseClient.from('historias_clinicas').select('*', { count: 'exact', head: true }),
      supabaseClient
        .from('historias_clinicas')
        .select('*', { count: 'exact', head: true })
        .or('estado_paciente.eq.en_tratamiento,estado_paciente.is.null'),
      supabaseClient
        .from('historias_clinicas')
        .select('*', { count: 'exact', head: true })
        .eq('estado_paciente', 'en_seguimiento'),
      supabaseClient
        .from('historias_clinicas')
        .select('*', { count: 'exact', head: true })
        .eq('estado_paciente', 'egreso'),
      supabaseClient
        .from('historias_clinicas')
        .select('policonsumo, atencion_guardia, triaje_nivel')
    ]);

    const total = resTotal.count ?? 0;
    actualizarTexto('totalFichasActivas', total);
    actualizarTexto('cantTratamiento', resTratamiento.count ?? 0);
    actualizarTexto('cantSeguimiento', resSeguimiento.count ?? 0);
    actualizarTexto('cantEgreso', resEgreso.count ?? 0);

    // Indicadores para Sala de Situación
    if (resEpi.data && total > 0) {
      const registros = resEpi.data;
      const cantPoli = registros.filter(r => r.policonsumo === 'SI').length;
      const cantGuardia = registros.filter(r => r.atencion_guardia === 'SI').length;
      const cantIcap = registros.filter(r => r.triaje_nivel === 'Atencion Ambulatoria (ICAP)').length;

      actualizarTexto('statPoliconsumo', `${Math.round((cantPoli / total) * 100)}%`);
      actualizarTexto('statGuardia', `${Math.round((cantGuardia / total) * 100)}%`);
      actualizarTexto('statIcap', `${Math.round((cantIcap / total) * 100)}%`);
    }
  } catch (err) {
    console.error('[MetricasError] Error al cargar métricas:', err);
  }
}

// --- BÚSQUEDA ---
async function ejecutarBusqueda() {
  const input = document.getElementById('buscarDNI');
  const tbody = document.getElementById('tablaPacientesBody');
  const contador = document.getElementById('contadorResultados');

  const raw = (input?.value || '').trim();
  const query = raw.replace(/[%_]/g, '').slice(0, 100);

  if (!query) {
    limpiarVistaInicial();
    cargarMetricasGlobales();
    return;
  }

  if (tbody) {
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'px-6 py-8 text-center text-xs text-slate-400';
    td.textContent = 'Buscando registros...';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  try {
    let consulta = supabaseClient
      .from('historias_clinicas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(SEARCH_LIMIT);

    if (/^\d{7,11}$/.test(query)) {
      consulta = consulta.eq('paciente_dni', query);
    } else {
      consulta = consulta.or(
        `paciente_nombre.ilike.%${query}%,paciente_apellido.ilike.%${query}%`
      );
    }

    const { data, error } = await consulta;

    if (error) throw error;

    const dnisVistos = new Set();
    const pacientesUnicos = (data || []).filter((p) => {
      if (!p.paciente_dni) return true;
      if (dnisVistos.has(p.paciente_dni)) return false;
      dnisVistos.add(p.paciente_dni);
      return true;
    });

    if (contador) contador.textContent = `${pacientesUnicos.length} resultados`;
    renderTablaSegura(pacientesUnicos);
  } catch (err) {
    console.error('[BusquedaError]', err);
    if (tbody) {
      tbody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'px-6 py-4 text-center text-xs text-red-500';
      td.textContent = 'Error al buscar historias clínicas.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }
}

function renderTablaSegura(registros) {
  const tbody = document.getElementById('tablaPacientesBody');
  const cards = document.getElementById('resultadoCardsMobile');

  if (tbody) tbody.innerHTML = '';
  if (cards) cards.innerHTML = '';

  if (!registros || registros.length === 0) {
    if (tbody) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'px-6 py-8 text-center text-xs text-amber-600';
      td.textContent = 'No se encontraron fichas clínicas asociadas.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    return;
  }

  const fragment = document.createDocumentFragment();

  registros.forEach((item) => {
    const fecha = item.created_at
      ? new Date(item.created_at).toLocaleDateString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })
      : 'N/I';
    const nombre = `${item.paciente_nombre || ''} ${item.paciente_apellido || ''}`.trim();
    const dni = item.paciente_dni || 'N/R';

    if (tbody) {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

      const tdDni = document.createElement('td');
      tdDni.className = 'px-4 lg:px-6 py-4 font-mono font-bold text-slate-900';
      tdDni.textContent = dni;

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
      btnVer.className =
        'text-xs bg-sky-50 text-sky-700 font-bold px-3 py-1.5 rounded-lg border border-sky-200 hover:bg-sky-100 transition';
      btnVer.textContent = 'Ver Historial';
      btnVer.addEventListener('click', () => verFichaPaciente(item.id));
      tdAccion.appendChild(btnVer);

      tr.append(tdDni, tdNombre, tdFecha, tdEstado, tdAccion);
      fragment.appendChild(tr);
    }
  });

  if (tbody) tbody.appendChild(fragment);
}

function crearBadgeEstado(estado) {
  const span = document.createElement('span');
  span.className = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border';
  const dot = document.createElement('span');
  dot.className = 'h-1.5 w-1.5 rounded-full';

  if (estado === 'en_seguimiento') {
    span.classList.add('bg-slate-100', 'text-slate-700', 'border-slate-300');
    dot.classList.add('bg-slate-400');
    span.append(dot, document.createTextNode('En seguimiento'));
  } else if (estado === 'egreso') {
    span.classList.add('bg-amber-50', 'text-amber-700', 'border-amber-200');
    dot.classList.add('bg-amber-500');
    span.append(dot, document.createTextNode('Egreso'));
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
    const { data, error } = await supabaseClient
      .from('historias_clinicas')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new Error('No se pudo cargar la ficha del paciente.');

    state.pacienteActual = data;

    actualizarTexto('fichaDniHeader', `FICHA - DNI ${data.paciente_dni || 'N/R'}`);
    actualizarTexto(
      'fichaNombreHeader',
      `${data.paciente_nombre || ''} ${data.paciente_apellido || ''}`.trim()
    );

    const badgeContainer = document.getElementById('fichaEstadoBadge');
    if (badgeContainer) {
      badgeContainer.innerHTML = '';
      badgeContainer.appendChild(crearBadgeEstado(data.estado_paciente));
    }

    const selectEstado = document.getElementById('cambioEstadoRapido');
    if (selectEstado) selectEstado.value = data.estado_paciente || 'en_tratamiento';

    const fechaInicio = new Date(data.created_at);
    const hoy = new Date();
    const dias = Math.floor((hoy - fechaInicio) / (1000 * 60 * 60 * 24));
    actualizarTexto('cantDiasFicha', dias >= 0 ? dias : 0);

    cargarEvolucionesTimeline(data);

    const detalle = document.getElementById('detalleFichaPaciente');
    if (detalle) {
      detalle.classList.remove('hidden');
      detalle.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    alert(err.message || 'Error al cargar la ficha.');
  }
}

function cargarEvolucionesTimeline(paciente) {
  let entradas = paciente.evoluciones_json;

  if (!Array.isArray(entradas) || entradas.length === 0) {
    entradas = [
      {
        tipo: 'Ingreso',
        fecha: paciente.created_at,
        motivo: paciente.motivo_consulta || 'Ingreso inicial registrado en el sistema.',
        dispositivo: 'Admisión',
        profesional: 'No registrado en el alta'
      }
    ];
  }

  let totalIngresos = 0;
  let totalEvoluciones = 0;

  const contenedor = document.getElementById('timelineContenedor');
  if (!contenedor) return;

  contenedor.innerHTML = '';
  const fragment = document.createDocumentFragment();

  entradas.forEach((item) => {
    if (item.tipo === 'Ingreso') totalIngresos++;
    if (item.tipo === 'Evolución') totalEvoluciones++;

    const fechaFormateada = item.fecha
      ? new Date(item.fecha).toLocaleDateString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'N/I';

    const entryDiv = document.createElement('div');
    entryDiv.className = 'relative pl-2';

    const dot = document.createElement('span');
    dot.className =
      'absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-sky-500 ring-4 ring-white';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'flex items-center gap-2 flex-wrap';

    const tipoSpan = document.createElement('span');
    tipoSpan.className = 'font-bold text-xs uppercase tracking-wider text-sky-800';
    tipoSpan.textContent = item.tipo || 'Entrada';

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
    fragment.appendChild(entryDiv);
  });

  actualizarTexto('cantIngresosFicha', totalIngresos);
  actualizarTexto('cantEvolucionesFicha', totalEvoluciones);
  contenedor.appendChild(fragment);
}

// --- EVOLUCIONES ---
async function guardarNuevaEntrada() {
  const motivo = document.getElementById('motivoEntrada')?.value?.trim();
  if (!motivo) {
    alert('Por favor complete la descripción de la entrada.');
    return;
  }

  if (!state.pacienteActual?.id) return;

  const nuevaEntrada = {
    tipo: document.getElementById('tipoEntrada')?.value || 'Evolución',
    fecha: new Date().toISOString(),
    motivo,
    dispositivo:
      document.getElementById('dispositivoEntrada')?.value?.trim() || 'No especificado',
    profesional:
      document.getElementById('profesionalEntrada')?.value?.trim() || 'No especificado'
  };

  try {
    const previas = Array.isArray(state.pacienteActual.evoluciones_json)
      ? [...state.pacienteActual.evoluciones_json]
      : [];
    previas.push(nuevaEntrada);

    const { error: updateError } = await supabaseClient
      .from('historias_clinicas')
      .update({ evoluciones_json: previas })
      .eq('id', state.pacienteActual.id);

    if (updateError) throw updateError;
    state.pacienteActual.evoluciones_json = previas;

    cargarEvolucionesTimeline(state.pacienteActual);
    resetInput('motivoEntrada');
    resetInput('dispositivoEntrada');
    resetInput('profesionalEntrada');
    document.getElementById('formNuevaEntrada')?.classList.add('hidden');
  } catch (err) {
    alert('Error al guardar la entrada: ' + (err.message || 'Error desconocido'));
  }
}

async function actualizarEstadoRapido(e) {
  if (!state.pacienteActual?.id) return;

  const nuevoEstado = e.target.value;
  const { error } = await supabaseClient
    .from('historias_clinicas')
    .update({ estado_paciente: nuevoEstado })
    .eq('id', state.pacienteActual.id);

  if (error) {
    alert('Error al actualizar el estado: ' + error.message);
  } else {
    state.pacienteActual.estado_paciente = nuevoEstado;
    verFichaPaciente(state.pacienteActual.id);
    cargarMetricasGlobales();
  }
}

// --- EXPORTACIÓN E HISTORIA CLÍNICA ---
function sanitizarValorExcel(valor) {
  if (valor == null) return '';
  const str = String(valor);
  if (['=', '+', '-', '@'].includes(str.charAt(0))) {
    return `'${str}`;
  }
  return str;
}

function abrirModalExportarFicha() {
  if (!state.pacienteActual) {
    alert('No hay ninguna ficha activa para exportar.');
    return;
  }
  const modal = document.getElementById('modalExportarFicha');
  if (modal) modal.classList.remove('hidden');
}

function cerrarModalExportarFicha() {
  document.getElementById('modalExportarFicha')?.classList.add('hidden');
}

async function confirmarExportarFicha() {
  if (!state.pacienteActual || !state.currentUser) return;
  const p = state.pacienteActual;

  const datos = [
    { Campo: 'DNI', Valor: sanitizarValorExcel(p.paciente_dni) },
    { Campo: 'Nombre', Valor: sanitizarValorExcel(p.paciente_nombre) },
    { Campo: 'Apellido', Valor: sanitizarValorExcel(p.paciente_apellido) },
    { Campo: 'Consentimiento Ético Ley 26.657', Valor: p.consentimiento_informado ? 'SI' : 'NO' },
    { Campo: 'Nivel Triaje (ICAP)', Valor: sanitizarValorExcel(p.triaje_nivel) },
    { Campo: 'Patología Dual', Valor: sanitizarValorExcel(p.patologia_dual) },
    { Campo: 'Sustancia Principal', Valor: sanitizarValorExcel(p.sustancia_consumida) },
    { Campo: 'Vía Administración', Valor: sanitizarValorExcel(p.via_administracion) },
    { Campo: 'Policonsumo', Valor: sanitizarValorExcel(p.policonsumo) },
    { Campo: 'Atención Guardia', Valor: sanitizarValorExcel(p.atencion_guardia) },
    { Campo: 'Estado Paciente', Valor: sanitizarValorExcel(p.estado_paciente) }
  ];

  const worksheet = XLSX.utils.json_to_sheet(datos);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ficha Clínica');
  XLSX.writeFile(workbook, `Ficha_Epi_${p.paciente_dni}.xlsx`);

  cerrarModalExportarFicha();
}

async function exportarBaseCompleta() {
  if (!esAdministrador(state.currentUser)) return;

  try {
    const { data, error } = await supabaseClient.from('historias_clinicas').select('*');
    if (error) throw error;

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Base Epidemiológica');
    XLSX.writeFile(workbook, `Base_Epidemiologica_MDS_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    alert('Error al exportar la base completa.');
  }
}

// --- GUARDAR O EDITAR HISTORIA CLÍNICA ---
function asegurarBotonEditarFicha() {
  const btnNueva = document.getElementById('btnNuevaEntrada');
  if (!btnNueva || document.getElementById('btnVerFichaCompleta')) return;

  const btn = document.createElement('button');
  btn.id = 'btnVerFichaCompleta';
  btn.type = 'button';
  btn.className =
    'text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100 transition mr-2';
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
  
  // Cargar casilla de consentimiento
  const chkConsentimiento = document.getElementById('consentimientoInformado');
  if (chkConsentimiento) {
    chkConsentimiento.checked = p.consentimiento_informado ?? true;
  }

  setVal('triajeNivel', p.triaje_nivel);
  setVal('patologiaDual', p.patologia_dual);
  setVal('riesgoInminente', p.riesgo_inminente);
  setVal('pacienteDni', p.paciente_dni);
  setVal('pacienteNombre', p.paciente_nombre);
  setVal('pacienteApellido', p.paciente_apellido);
  setVal('estadoPaciente', p.estado_paciente || 'en_tratamiento');
  setVal('sexo', p.sexo);
  setVal('fechaNacimiento', p.fecha_nacimiento);
  setVal('edad', p.edad);
  setVal('grupoEtario', p.grupo_etario);
  setVal('localidad', p.localidad);
  setVal('barrioResidencia', p.barrio_residencia);
  setVal('nivelEducativo', p.nivel_educativo);
  setVal('situacionLaboral', p.situacion_laboral);
  setVal('sustanciaConsumida', p.sustancia_consumida);
  setVal('viaAdministracion', p.via_administracion);
  setVal('edadInicio', p.edad_inicio);
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
}

async function guardarHistoriaClinica(e) {
  e.preventDefault();
  const clinicalStatus = document.getElementById('clinicalStatus');

  // Validar explícitamente el consentimiento ética/legal
  const consentimientoChecked = document.getElementById('consentimientoInformado')?.checked;

  if (!consentimientoChecked) {
    alert('Debe confirmar el resguardo ético y consentimiento de datos (Ley 26.657) antes de guardar la ficha.');
    return;
  }

  const getVal = (id) => {
    const val = document.getElementById(id)?.value?.trim();
    return val === '' ? null : val;
  };

  const payload = {
    medico_id: state.currentUser.id,
    consentimiento_informado: consentimientoChecked,
    triaje_nivel: getVal('triajeNivel'),
    patologia_dual: getVal('patologiaDual'),
    riesgo_inminente: getVal('riesgoInminente'),
    paciente_dni: getVal('pacienteDni'),
    paciente_nombre: getVal('pacienteNombre'),
    paciente_apellido: getVal('pacienteApellido'),
    estado_paciente: getVal('estadoPaciente') || 'en_tratamiento',
    sexo: getVal('sexo'),
    fecha_nacimiento: getVal('fechaNacimiento'),
    edad: getVal('edad') ? parseInt(getVal('edad'), 10) : null,
    grupo_etario: getVal('grupoEtario'),
    localidad: getVal('localidad'),
    barrio_residencia: getVal('barrioResidencia'),
    nivel_educativo: getVal('nivelEducativo'),
    situacion_laboral: getVal('situacionLaboral'),
    sustancia_consumida: getVal('sustanciaConsumida'),
    via_administracion: getVal('viaAdministracion'),
    edad_inicio: getVal('edadInicio') ? parseInt(getVal('edadInicio'), 10) : null,
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
    observaciones: getVal('observaciones')
  };

  try {
    let respuesta;
    if (state.pacienteActual?.id) {
      respuesta = await supabaseClient
        .from('historias_clinicas')
        .update(payload)
        .eq('id', state.pacienteActual.id);
    } else {
      payload.evoluciones_json = [
        {
          tipo: 'Ingreso',
          fecha: new Date().toISOString(),
          motivo: payload.motivo_consulta || 'Ingreso registrado en el sistema.',
          dispositivo: 'Admisión',
          profesional: obtenerNombreProfesional(state.currentUser)
        }
      ];
      respuesta = await supabaseClient.from('historias_clinicas').insert([payload]);
    }

    if (respuesta.error) throw respuesta.error;

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

// --- UTILIDADES ---
function actualizarTexto(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

function resetInput(id) {
  const el = document.getElementById(id);
  if (el) el.value = '';
}
