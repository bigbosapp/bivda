import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { auth, authReady } from "./firebase.js";
import {
  createRecordId,
  initializeUserData,
  removeRecord,
  saveNamedRecord,
  saveRecord,
  subscribeToUserData
} from "./data-store.js";

    const CLOUDINARY_CLOUD_NAME = "dcjdq3sxq";
    const CLOUDINARY_UPLOAD_PRESET = "tetstist";

    let dbCategories = [];
    let dbCustomers = [];
    let dbTransactions = [];
    let dbLosses = [];
    let currentUser = null;
    let currentChart = null;
    let currentChartPeriod = 'daily';
    let currentChartMode = 'combined';
    let unsubscribeUserData = null;
    let isRegisterMode = false;
    let authGeneration = 0;
    let editingCategoryId = null;
    let editingCustomerId = null;

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function safeExternalUrl(value) {
      try {
        const url = new URL(String(value || ''), window.location.href);
        return url.protocol === 'https:' ? escapeHtml(url.href) : '';
      } catch {
        return '';
      }
    }

    function normalizedName(value) {
      return String(value ?? '').trim().toLocaleLowerCase('id-ID');
    }

    function setSyncStatus(state, error = null) {
      const badge = document.getElementById('syncStatus');
      if (!badge) return;
      const text = {
        loading: 'Menghubungkan ke Cloud…',
        local: 'Data dari cache perangkat · menunggu Cloud',
        connected: 'Cloud aktif · data akun tersinkron',
        stopped: 'Sinkronisasi berhenti',
        error: `Sinkronisasi gagal${error?.code ? ` (${error.code})` : ''}`
      }[state] || 'Status penyimpanan tidak diketahui';
      badge.textContent = text;
      badge.title = error?.message || text;
      badge.classList.toggle('text-red-600', state === 'error');
      badge.classList.toggle('text-emerald-600', state === 'connected');
      badge.classList.toggle('text-amber-600', state === 'local' || state === 'loading');
    }

    function renderAllUserData() {
      renderCategories();
      renderCustomers();
      renderLosses();
      renderTransactions();
      renderFileManager();
      renderChart();
    }

    function handleStorageError(action, error) {
      console.error(`Gagal ${action}:`, error);
      const reason = error?.code || error?.message || 'koneksi atau izin Firebase tidak tersedia';
      showAppAlert(`Data belum dikonfirmasi tersimpan ke Cloud. ${reason}. Coba lagi setelah koneksi dan akses Firestore diperiksa.`, 'Penyimpanan Gagal');
    }

    // CUSTOM MODERN NOTIFICATIONS
    window.showAppAlert = function(message, title = 'Informasi') {
      document.getElementById('modernAlertTitle').textContent = title;
      document.getElementById('modernAlertMessage').textContent = message;
      document.getElementById('modernAlertModal').classList.remove('hidden');
    }

    document.getElementById('modernAlertBtn').addEventListener('click', () => {
      document.getElementById('modernAlertModal').classList.add('hidden');
    });

    window.showAppConfirm = function(message, onYes, title = 'Konfirmasi') {
      document.getElementById('modernConfirmTitle').textContent = title;
      document.getElementById('modernConfirmMessage').textContent = message;
      const modal = document.getElementById('modernConfirmModal');
      modal.classList.remove('hidden');

      const yesBtn = document.getElementById('modernConfirmYes');
      const noBtn = document.getElementById('modernConfirmNo');

      const newYes = yesBtn.cloneNode(true);
      const newNo = noBtn.cloneNode(true);
      yesBtn.parentNode.replaceChild(newYes, yesBtn);
      noBtn.parentNode.replaceChild(newNo, noBtn);

      newYes.addEventListener('click', async () => {
        modal.classList.add('hidden');
        try {
          await onYes();
        } catch (error) {
          handleStorageError('menyimpan perubahan', error);
        }
      });

      newNo.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }

    document.addEventListener('DOMContentLoaded', async () => {
      lucide.createIcons();
      initAppEvents();
      await authReady;

      onAuthStateChanged(auth, (user) => {
        const generation = ++authGeneration;
        if (unsubscribeUserData) {
          unsubscribeUserData();
          unsubscribeUserData = null;
        }
        if (user) {
          currentUser = user;
          showMainApp();
          setSyncStatus('loading');
          dbCategories = [];
          dbCustomers = [];
          dbTransactions = [];
          dbLosses = [];
          renderAllUserData();
          initializeUserData(user.uid).then(() => {
            if (generation !== authGeneration || currentUser?.uid !== user.uid) return;
            unsubscribeUserData = subscribeToUserData(user.uid, (data) => {
              dbCategories = data.categories;
              dbCustomers = data.customers;
              dbTransactions = data.transactions;
              dbLosses = data.losses;
              renderAllUserData();
            }, (state, error) => {
              setSyncStatus(state, error);
              if (state === 'error') {
                showAppAlert(`Data Cloud tidak dapat dimuat atau disinkronkan. ${error?.code || error?.message || ''} Periksa Firestore Rules dan koneksi.`, 'Sinkronisasi Gagal');
              }
            });
          }).catch((error) => {
            if (generation !== authGeneration) return;
            setSyncStatus('error', error);
            showAppAlert(`Aplikasi gagal menyiapkan data akun. ${error?.code || error?.message || ''} Pastikan Firestore Rules sudah dipasang.`, 'Gagal Memuat Data');
          });
        } else {
          currentUser = null;
          dbCategories = [];
          dbCustomers = [];
          dbTransactions = [];
          dbLosses = [];
          showLoginScreen();
          setSyncStatus('stopped');
        }
      });
    });

    function showLoginScreen() {
      document.getElementById('authScreen').classList.remove('hidden');
      document.getElementById('mainHeader').classList.add('hidden');
      document.getElementById('dashboardContent').classList.add('hidden');
    }

    function showMainApp() {
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('mainHeader').classList.remove('hidden');
      document.getElementById('dashboardContent').classList.remove('hidden');
      document.getElementById('userEmailNav').textContent = currentUser.email;
    }

    // EVENTS BINDING
    function initAppEvents() {
      // Toggle Login / Register Mode
      const btnToggleAuth = document.getElementById('btnToggleAuthMode');
      function toggleAuthMode(e) {
        e.preventDefault();
        isRegisterMode = !isRegisterMode;
        const title = document.getElementById('authTitleText');
        const subtitle = document.getElementById('authSubtitleText');
        const btnLabel = document.getElementById('authBtnLabel');
        const prompt = document.getElementById('authTogglePrompt');

        if (isRegisterMode) {
          title.textContent = 'Daftar Akun BIVDA';
          subtitle.textContent = 'Buat akun baru untuk mulai mengelola bisnis';
          btnLabel.textContent = 'Daftar Akun';
          prompt.innerHTML = 'Sudah punya akun? <button id="btnToggleAuthMode" class="text-indigo-600 font-bold hover:underline ml-1">Masuk Sekarang</button>';
        } else {
          title.textContent = 'Masuk ke BIVDA';
          subtitle.textContent = 'Platform Analisis Bisnis & Manajemen Nota Terpadu';
          btnLabel.textContent = 'Masuk';
          prompt.innerHTML = 'Belum punya akun? <button id="btnToggleAuthMode" class="text-indigo-600 font-bold hover:underline ml-1">Daftar Sekarang</button>';
        }
        document.getElementById('btnToggleAuthMode').addEventListener('click', toggleAuthMode);
      }
      btnToggleAuth.addEventListener('click', toggleAuthMode);

      document.getElementById('authForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('authEmail').value;
        const pass = document.getElementById('authPassword').value;
        const alertBox = document.getElementById('authAlert');
        alertBox.classList.add('hidden');

        try {
          if (isRegisterMode) {
            await createUserWithEmailAndPassword(auth, email, pass);
            showAppAlert('Akun berhasil didaftarkan!', 'Sukses');
          } else {
            await signInWithEmailAndPassword(auth, email, pass);
          }
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.classList.remove('hidden');
        }
      });

      document.getElementById('btnLogout').addEventListener('click', () => {
        showAppConfirm('Apakah Anda yakin ingin keluar dari aplikasi?', async () => {
          await signOut(auth);
        }, 'Konfirmasi Keluar');
      });

      // Mobile Drawer Trigger & Close
      const mobileDrawer = document.getElementById('mobileDrawer');
      const drawerOverlay = document.getElementById('mobileDrawerOverlay');
      
      document.getElementById('btnMobileMenu').addEventListener('click', () => {
        mobileDrawer.classList.remove('-translate-x-full');
        drawerOverlay.classList.remove('hidden');
      });
      document.getElementById('btnCloseDrawer').addEventListener('click', closeDrawer);
      drawerOverlay.addEventListener('click', closeDrawer);

      function closeDrawer() {
        mobileDrawer.classList.add('-translate-x-full');
        drawerOverlay.classList.add('hidden');
      }

      function buildDrawerNav() {
        const container = document.getElementById('drawerNavItems');
        container.innerHTML = '';
        const tabs = [
          { id: 'tab-transaksi', label: 'Transaksi', icon: 'receipt' },
          { id: 'tab-input-banyak', label: 'Input Banyak Nota', icon: 'layers' },
          { id: 'tab-kategori', label: 'Data Kategori', icon: 'tags' },
          { id: 'tab-pembeli', label: 'Data Pembeli', icon: 'users' },
          { id: 'tab-kerugian', label: 'Kerugian', icon: 'trending-down' },
          { id: 'tab-analytics', label: 'Grafik & Analisis BI', icon: 'bar-chart-3' },
          { id: 'tab-files', label: 'File Manager', icon: 'folder-open' }
        ];

        tabs.forEach(t => {
          const btn = document.createElement('button');
          btn.className = 'flex items-center space-x-3 w-full px-4 py-3 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 transition';
          btn.innerHTML = `<i data-lucide="${t.icon}" class="w-5 h-5 text-indigo-600"></i><span>${t.label}</span>`;
          btn.addEventListener('click', () => {
            switchTab(t.id);
            closeDrawer();
          });
          container.appendChild(btn);
        });
        lucide.createIcons();
      }
      buildDrawerNav();

      // Tab Navigation
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          switchTab(btn.getAttribute('data-tab'));
        });
      });

      function switchTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-600/20');
          b.classList.add('text-slate-600', 'hover:bg-slate-200/60');
        });
        const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (activeBtn) {
          activeBtn.classList.add('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-600/20');
          activeBtn.classList.remove('text-slate-600', 'hover:bg-slate-200/60');
        }

        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
        document.getElementById(tabId).classList.remove('hidden');

        if (tabId === 'tab-analytics') renderChart();
        if (tabId === 'tab-files') renderFileManager();
      }

      // Category Auto Price & Custom Nominal
      document.getElementById('txCategory').addEventListener('change', (e) => {
        const val = e.target.value;
        const customContainer = document.getElementById('txCustomNominalContainer');
        if (val === '__manual_price__') {
          customContainer.classList.remove('hidden');
          document.getElementById('txCustomNominal').required = true;
        } else {
          customContainer.classList.add('hidden');
          document.getElementById('txCustomNominal').required = false;
        }
        updateSingleTotalDisplay();
      });

      document.getElementById('txQty').addEventListener('input', updateSingleTotalDisplay);
      document.getElementById('txCustomNominal').addEventListener('input', updateSingleTotalDisplay);

      const dropZone = document.getElementById('dropZoneSingle');
      const fileInput = document.getElementById('txFilesInput');
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleSingleFilesSelect);

      document.getElementById('singleTxForm').addEventListener('submit', handleSaveSingleTx);
      document.getElementById('btnAddBatchRow').addEventListener('click', addBatchRow);
      document.getElementById('btnSaveBatch').addEventListener('click', handleSaveBatch);
      document.getElementById('categoryForm').addEventListener('submit', handleSaveCategory);
      document.getElementById('customerForm').addEventListener('submit', handleSaveCustomer);
      document.getElementById('cancelCategoryEdit').addEventListener('click', resetCategoryEdit);
      document.getElementById('cancelCustomerEdit').addEventListener('click', resetCustomerEdit);
      document.getElementById('catTableBody').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (button.dataset.action === 'edit-category') window.editCategory(button.dataset.id);
        if (button.dataset.action === 'delete-category') window.deleteCategory(button.dataset.id);
      });
      document.getElementById('custTableBody').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (button.dataset.action === 'edit-customer') window.editCustomer(button.dataset.id);
        if (button.dataset.action === 'delete-customer') window.deleteCustomer(button.dataset.id);
      });
      document.getElementById('lossTableBody').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (button?.dataset.action === 'delete-loss') window.deleteLoss(button.dataset.id);
      });
      document.getElementById('txTableBody').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (button.dataset.action === 'view-transaction') window.viewDetail(button.dataset.id);
        if (button.dataset.action === 'delete-transaction') window.deleteTransaction(button.dataset.id);
      });
      document.getElementById('batchTableBody').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action="remove-batch-row"]');
        if (button) document.getElementById(button.dataset.rowId)?.remove();
      });
      document.getElementById('lossForm').addEventListener('submit', handleSaveLoss);

      document.getElementById('searchTxInput').addEventListener('input', (e) => {
        renderTransactions(e.target.value.toLocaleLowerCase('id-ID'));
      });

      document.querySelectorAll('.chart-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.chart-period-btn').forEach(b => {
            b.classList.remove('bg-indigo-600', 'text-white', 'shadow-sm');
            b.classList.add('text-slate-600', 'hover:text-slate-900');
          });
          btn.classList.add('bg-indigo-600', 'text-white', 'shadow-sm');
          btn.classList.remove('text-slate-600', 'hover:text-slate-900');
          currentChartPeriod = btn.getAttribute('data-period');
          renderChart();
        });
      });

      document.querySelectorAll('.chart-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.chart-mode-btn').forEach(button => {
            button.classList.remove('bg-indigo-600', 'text-white', 'shadow-sm');
            button.classList.add('text-slate-600', 'hover:text-slate-900');
            button.setAttribute('aria-pressed', 'false');
          });
          btn.classList.add('bg-indigo-600', 'text-white', 'shadow-sm');
          btn.classList.remove('text-slate-600', 'hover:text-slate-900');
          btn.setAttribute('aria-pressed', 'true');
          currentChartMode = btn.getAttribute('data-chart-mode');
          renderChart();
        });
      });

      document.getElementById('btnResetZoom').addEventListener('click', () => {
        if (currentChart) currentChart.resetZoom();
      });

      document.getElementById('btnCloseDetailModal').addEventListener('click', () => {
        document.getElementById('txDetailModal').classList.add('hidden');
      });

      addBatchRow();
    }

    function updateSingleTotalDisplay() {
      const catVal = document.getElementById('txCategory').value;
      const qty = parseInt(document.getElementById('txQty').value) || 1;
      let unitPrice = 0;

      if (catVal === '__manual_price__') {
        unitPrice = parseFloat(document.getElementById('txCustomNominal').value) || 0;
      } else if (catVal) {
        const foundCat = dbCategories.find(c => c.name === catVal);
        if (foundCat) unitPrice = foundCat.price;
      }

      const total = unitPrice * qty;
      document.getElementById('txTotalDisplay').value = `Rp ${total.toLocaleString('id-ID')}`;
    }

    function updateLocalRecord(collectionName, record) {
      const collection = {
        categories: dbCategories,
        customers: dbCustomers,
        transactions: dbTransactions,
        losses: dbLosses
      }[collectionName];
      const index = collection.findIndex((item) => item.id === record.id);
      if (index >= 0) collection[index] = record;
      else collection.unshift(record);
      if (collectionName === 'categories' || collectionName === 'customers') {
        collection.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id'));
      }
    }

    function refreshBatchOptions() {
      document.querySelectorAll('#batchTableBody .b-cat').forEach((select) => {
        const selected = select.value;
        select.innerHTML = '<option value="">-- Pilih --</option>';
        dbCategories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category.name;
          option.textContent = category.name;
          select.appendChild(option);
        });
        select.appendChild(new Option('Nominal Manual', '__manual_price__'));
        if ([...select.options].some((option) => option.value === selected)) select.value = selected;
      });
      document.querySelectorAll('#batchTableBody .b-cust').forEach((select) => {
        const selected = select.value;
        select.innerHTML = '<option value="Umum / Tanpa Nama">Umum</option>';
        dbCustomers.forEach((customer) => {
          const option = document.createElement('option');
          option.value = customer.name;
          option.textContent = customer.name;
          select.appendChild(option);
        });
        if ([...select.options].some((option) => option.value === selected)) select.value = selected;
      });
    }

    // CATEGORIES
    function renderCategories() {
      const select = document.getElementById('txCategory');
      const currentSelected = select.value;
      select.innerHTML = '<option value="">-- Pilih Kategori --</option>';
      dbCategories.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.name;
        option.textContent = `${cat.name} (Rp ${Number(cat.price || 0).toLocaleString('id-ID')})`;
        select.appendChild(option);
      });
      select.appendChild(new Option('Lainnya (Nominal Manual)', '__manual_price__'));
      if ([...select.options].some((option) => option.value === currentSelected)) select.value = currentSelected;

      const tbody = document.getElementById('catTableBody');
      tbody.innerHTML = dbCategories.map((cat) => `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3.5 font-semibold text-slate-800">${escapeHtml(cat.name)}</td>
          <td class="p-3.5 text-indigo-600 font-medium">Rp ${Number(cat.price || 0).toLocaleString('id-ID')}</td>
          <td class="p-3.5 text-center space-x-2">
            <button type="button" data-action="edit-category" data-id="${escapeHtml(cat.id)}" class="text-indigo-600 hover:text-indigo-800 p-1" aria-label="Ubah kategori ${escapeHtml(cat.name)}"><i data-lucide="pencil" class="w-4 h-4 inline"></i></button>
            <button type="button" data-action="delete-category" data-id="${escapeHtml(cat.id)}" class="text-red-500 hover:text-red-700 p-1" aria-label="Hapus kategori ${escapeHtml(cat.name)}"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>
          </td>
        </tr>
      `).join('');
      refreshBatchOptions();
      lucide.createIcons();
    }

    function resetCategoryEdit() {
      editingCategoryId = null;
      document.getElementById('categoryForm').reset();
      document.getElementById('categorySubmitLabel').textContent = 'Simpan Kategori';
      document.getElementById('cancelCategoryEdit').classList.add('hidden');
    }

    window.editCategory = function(id) {
      const category = dbCategories.find((item) => item.id === id);
      if (!category) return;
      editingCategoryId = id;
      document.getElementById('catName').value = category.name;
      document.getElementById('catPrice').value = category.price;
      document.getElementById('categorySubmitLabel').textContent = 'Simpan Perubahan';
      document.getElementById('cancelCategoryEdit').classList.remove('hidden');
      document.getElementById('catName').focus();
    };

    async function handleSaveCategory(e) {
      e.preventDefault();
      if (!currentUser) return showAppAlert('Silakan masuk kembali sebelum menyimpan.', 'Sesi Berakhir');
      const name = document.getElementById('catName').value.trim();
      const price = Number(document.getElementById('catPrice').value);
      if (!name || !Number.isFinite(price) || price < 0) {
        return showAppAlert('Nama kategori dan harga yang valid wajib diisi.', 'Periksa Data');
      }
      if (dbCategories.some((item) => item.id !== editingCategoryId && normalizedName(item.name) === normalizedName(name))) {
        return showAppAlert('Kategori dengan nama tersebut sudah ada.', 'Kategori Duplikat');
      }

      const record = { id: editingCategoryId || '', name, price };
      try {
        const saved = await saveNamedRecord(currentUser.uid, 'categories', record);
        if (editingCategoryId && editingCategoryId !== saved.id) {
          dbCategories = dbCategories.filter((item) => item.id !== editingCategoryId);
        }
        updateLocalRecord('categories', saved);
        renderCategories();
        resetCategoryEdit();
        showAppAlert('Kategori tersimpan ke Cloud dan akan muncul di perangkat lain yang memakai akun ini.', 'Sukses');
      } catch (error) {
        handleStorageError('menyimpan kategori', error);
      }
    }

    window.deleteCategory = function(id) {
      showAppConfirm('Hapus kategori ini? Riwayat transaksi yang sudah memakai nama kategori tersebut tetap dipertahankan.', async () => {
        if (!currentUser) throw new Error('Sesi akun sudah berakhir.');
        await removeRecord(currentUser.uid, 'categories', id);
        dbCategories = dbCategories.filter((item) => item.id !== id);
        renderCategories();
        showAppAlert('Kategori dihapus dari Cloud.', 'Sukses');
      }, 'Hapus Kategori');
    };

    // CUSTOMERS
    function renderCustomers() {
      const select = document.getElementById('txCustomer');
      const currentSelected = select.value;
      select.innerHTML = '<option value="Umum / Tanpa Nama">Umum / Tanpa Nama</option>';
      dbCustomers.forEach((customer) => {
        const option = document.createElement('option');
        option.value = customer.name;
        option.textContent = customer.name;
        select.appendChild(option);
      });
      if ([...select.options].some((option) => option.value === currentSelected)) select.value = currentSelected;

      const tbody = document.getElementById('custTableBody');
      tbody.innerHTML = dbCustomers.map((cust) => `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3.5 font-semibold text-slate-800">${escapeHtml(cust.name)}</td>
          <td class="p-3.5 text-slate-500">${escapeHtml(cust.address || '-')}</td>
          <td class="p-3.5 text-slate-500">${escapeHtml(cust.phone || '-')}</td>
          <td class="p-3.5 text-center space-x-2">
            <button type="button" data-action="edit-customer" data-id="${escapeHtml(cust.id)}" class="text-indigo-600 hover:text-indigo-800 p-1" aria-label="Ubah pembeli ${escapeHtml(cust.name)}"><i data-lucide="pencil" class="w-4 h-4 inline"></i></button>
            <button type="button" data-action="delete-customer" data-id="${escapeHtml(cust.id)}" class="text-red-500 hover:text-red-700 p-1" aria-label="Hapus pembeli ${escapeHtml(cust.name)}"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>
          </td>
        </tr>
      `).join('');
      refreshBatchOptions();
      lucide.createIcons();
    }

    function resetCustomerEdit() {
      editingCustomerId = null;
      document.getElementById('customerForm').reset();
      document.getElementById('customerSubmitLabel').textContent = 'Simpan Pembeli';
      document.getElementById('cancelCustomerEdit').classList.add('hidden');
    }

    window.editCustomer = function(id) {
      const customer = dbCustomers.find((item) => item.id === id);
      if (!customer) return;
      editingCustomerId = id;
      document.getElementById('custName').value = customer.name;
      document.getElementById('custAddress').value = customer.address || '';
      document.getElementById('custPhone').value = customer.phone || '';
      document.getElementById('customerSubmitLabel').textContent = 'Simpan Perubahan';
      document.getElementById('cancelCustomerEdit').classList.remove('hidden');
      document.getElementById('custName').focus();
    };

    async function handleSaveCustomer(e) {
      e.preventDefault();
      if (!currentUser) return showAppAlert('Silakan masuk kembali sebelum menyimpan.', 'Sesi Berakhir');
      const name = document.getElementById('custName').value.trim();
      const address = document.getElementById('custAddress').value.trim();
      const phone = document.getElementById('custPhone').value.trim();
      if (!name) return showAppAlert('Nama pembeli wajib diisi.', 'Periksa Data');
      if (dbCustomers.some((item) => item.id !== editingCustomerId && normalizedName(item.name) === normalizedName(name))) {
        return showAppAlert('Pembeli dengan nama tersebut sudah ada. Ubah data pembeli yang sudah terdaftar.', 'Pembeli Duplikat');
      }

      const record = { id: editingCustomerId || '', name, address, phone };
      try {
        const saved = await saveNamedRecord(currentUser.uid, 'customers', record);
        if (editingCustomerId && editingCustomerId !== saved.id) {
          dbCustomers = dbCustomers.filter((item) => item.id !== editingCustomerId);
        }
        updateLocalRecord('customers', saved);
        renderCustomers();
        resetCustomerEdit();
        showAppAlert('Data pembeli tersimpan ke Cloud dan akan muncul di perangkat lain yang memakai akun ini.', 'Sukses');
      } catch (error) {
        handleStorageError('menyimpan data pembeli', error);
      }
    }

    window.deleteCustomer = function(id) {
      showAppConfirm('Hapus data pembeli ini? Riwayat transaksi yang sudah mencatat namanya tetap dipertahankan.', async () => {
        if (!currentUser) throw new Error('Sesi akun sudah berakhir.');
        await removeRecord(currentUser.uid, 'customers', id);
        dbCustomers = dbCustomers.filter((item) => item.id !== id);
        renderCustomers();
        showAppAlert('Data pembeli dihapus dari Cloud.', 'Sukses');
      }, 'Hapus Pembeli');
    };

    // LOSSES (KERUGIAN)
    function renderLosses() {
      const tbody = document.getElementById('lossTableBody');
      tbody.innerHTML = '';
      if (!dbLosses || dbLosses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Belum ada data kerugian tercatat.</td></tr>`;
        return;
      }
      dbLosses.forEach(loss => {
        tbody.innerHTML += `
          <tr class="hover:bg-slate-50 transition">
            <td class="p-3.5 font-semibold text-slate-800">${escapeHtml(loss.title || 'Kerugian Tanpa Judul')}</td>
            <td class="p-3.5 text-right font-bold text-red-600">Rp ${Number(loss.nominal || 0).toLocaleString('id-ID')}</td>
            <td class="p-3.5 text-slate-500">${escapeHtml(loss.description || '-')}</td>
            <td class="p-3.5 text-center">
              <button type="button" data-action="delete-loss" data-id="${escapeHtml(loss.id)}" class="text-red-500 hover:text-red-700 p-1">
                <i data-lucide="trash-2" class="w-4 h-4 inline"></i>
              </button>
            </td>
          </tr>
        `;
      });
      lucide.createIcons();
    }

    async function handleSaveLoss(e) {
      e.preventDefault();
      const nominal = parseFloat(document.getElementById('lossNominal').value);
      if (isNaN(nominal) || nominal < 0) {
        showAppAlert('Nominal kerugian wajib diisi dengan benar!', 'Peringatan');
        return;
      }
      const title = document.getElementById('lossTitle').value.trim();
      const description = document.getElementById('lossDesc').value.trim();

      if (!currentUser) return showAppAlert('Silakan masuk kembali sebelum menyimpan.', 'Sesi Berakhir');
      const lossRecord = {
        id: createRecordId('loss'),
        title: title,
        nominal: nominal,
        description: description,
        date: new Date().toISOString().split('T')[0]
      };

      try {
        await saveRecord(currentUser.uid, 'losses', lossRecord);
      } catch (error) {
        return handleStorageError('menyimpan data kerugian', error);
      }
      updateLocalRecord('losses', lossRecord);
      renderLosses();
      renderChart();
      document.getElementById('lossForm').reset();
      showAppAlert('Data kerugian tersimpan ke Cloud.', 'Sukses');
    }

    window.deleteLoss = function(id) {
      showAppConfirm('Apakah Anda yakin ingin menghapus catatan kerugian ini?', async () => {
        if (!currentUser) throw new Error('Sesi akun sudah berakhir.');
        await removeRecord(currentUser.uid, 'losses', id);
        dbLosses = dbLosses.filter((loss) => loss.id !== id);
        renderLosses();
        renderChart();
        showAppAlert('Data kerugian dihapus dari Cloud.', 'Sukses');
      }, 'Hapus Kerugian');
    }

    // CLOUDINARY UPLOAD
    let selectedSingleFiles = [];

    function handleSingleFilesSelect(e) {
      const files = Array.from(e.target.files);
      const container = document.getElementById('txFilesPreview');
      container.innerHTML = '';
      selectedSingleFiles = [];

      files.forEach(file => {
        if (file.size > 10 * 1024 * 1024) {
          showAppAlert(`File ${file.name} melebihi batas 10MB!`, 'Batas Ukuran');
          return;
        }
        selectedSingleFiles.push(file);
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.className = 'w-14 h-14 object-cover rounded-xl border border-slate-300 shadow-sm';
        container.appendChild(img);
      });
    }

    async function uploadFileToCloudinary(file) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Gagal unggah berkas ke Cloudinary');
      const data = await res.json();
      return data.secure_url;
    }

    // SINGLE TRANSACTION
    async function handleSaveSingleTx(e) {
      e.preventDefault();
      if (!currentUser) return showAppAlert('Silakan masuk kembali sebelum menyimpan.', 'Sesi Berakhir');
      showAppConfirm('Apakah Anda yakin ingin menyimpan nota transaksi ini?', async () => {
        const btn = document.getElementById('btnSaveSingleTx');
        btn.disabled = true;
        btn.innerHTML = '<span>Mengunggah File & Menyimpan...</span>';

        try {
          const uploadedUrls = [];
          for (const file of selectedSingleFiles) {
            const url = await uploadFileToCloudinary(file);
            uploadedUrls.push(url);
          }

          const catVal = document.getElementById('txCategory').value;
          const qty = Number(document.getElementById('txQty').value);
          let unitPrice = 0;

          if (catVal === '__manual_price__') {
            unitPrice = Number(document.getElementById('txCustomNominal').value);
          } else {
            const found = dbCategories.find(c => c.name === catVal);
            if (found) unitPrice = found.price;
          }
          if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) {
            throw new Error('Jumlah atau harga tidak valid.');
          }

          const txRecord = {
            id: createRecordId('tx'),
            date: document.getElementById('txDate').value,
            itemName: document.getElementById('txItemName').value.trim(),
            category: catVal === '__manual_price__' ? 'Lainnya' : catVal,
            qty: qty,
            customer: document.getElementById('txCustomer').value,
            total: unitPrice * qty,
            invoiceNo: document.getElementById('txInvoiceNo').value.trim(),
            files: uploadedUrls,
            isGroup: false
          };

          await saveRecord(currentUser.uid, 'transactions', txRecord);
          updateLocalRecord('transactions', txRecord);
          renderTransactions();
          renderChart();
          document.getElementById('singleTxForm').reset();
          document.getElementById('txFilesPreview').innerHTML = '';
          selectedSingleFiles = [];
          updateSingleTotalDisplay();
          showAppAlert('Transaksi nota tersimpan ke Cloud.', 'Sukses');
        } catch (err) {
          handleStorageError('menyimpan transaksi', err);
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i><span>Simpan Transaksi Nota</span>';
          lucide.createIcons();
        }
      }, 'Konfirmasi Simpan');
    }

    // BATCH ENTRY
    function addBatchRow() {
      const tbody = document.getElementById('batchTableBody');
      const rowId = createRecordId('row');

      let categoryOptions = '<option value="">-- Pilih --</option>';
      dbCategories.forEach(c => categoryOptions += `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`);
      categoryOptions += '<option value="__manual_price__">Nominal Manual</option>';

      let customerOptions = '<option value="Umum / Tanpa Nama">Umum</option>';
      dbCustomers.forEach(c => customerOptions += `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`);

      const tr = document.createElement('tr');
      tr.id = `batchRow_${rowId}`;
      tr.className = 'border-b border-slate-100 hover:bg-slate-50 transition';
      tr.innerHTML = `
        <td class="p-2.5"><input type="date" class="b-date w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800" required></td>
        <td class="p-2.5"><input type="text" placeholder="Nama Barang" class="b-name w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800" required></td>
        <td class="p-2.5"><select class="b-cat w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800" required>${categoryOptions}</select></td>
        <td class="p-2.5"><input type="number" value="1" min="1" class="b-qty w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800"></td>
        <td class="p-2.5"><select class="b-cust w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800">${customerOptions}</select></td>
        <td class="p-2.5"><input type="number" min="0" placeholder="Total (Rp)" class="b-total w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-bold text-indigo-600" required></td>
        <td class="p-2.5"><input type="text" placeholder="No Nota" class="b-inv w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800"></td>
        <td class="p-2.5"><input type="file" multiple accept="image/*" class="b-file w-full text-[10px] text-slate-500"></td>
        <td class="p-2.5 text-center">
          <button type="button" data-action="remove-batch-row" data-row-id="batchRow_${rowId}" class="text-red-500 hover:text-red-700 p-1"><i data-lucide="trash" class="w-4 h-4"></i></button>
        </td>
      `;

      tbody.appendChild(tr);
      lucide.createIcons();
    }

    async function handleSaveBatch() {
      const title = document.getElementById('batchGroupTitle').value.trim();
      if (!title) {
        showAppAlert('Harap isi Judul Grup Nota terlebih dahulu!', 'Peringatan');
        return;
      }

      const rows = document.querySelectorAll('#batchTableBody tr');
      if (rows.length === 0) {
        showAppAlert('Minimal buat 1 baris transaksi!', 'Peringatan');
        return;
      }
      const invalidRow = [...rows].find((row) => {
        const quantity = Number(row.querySelector('.b-qty').value);
        const total = Number(row.querySelector('.b-total').value);
        return !row.querySelector('.b-date').value
          || !row.querySelector('.b-name').value.trim()
          || !row.querySelector('.b-cat').value
          || !Number.isInteger(quantity) || quantity < 1
          || !Number.isFinite(total) || total < 0;
      });
      if (invalidRow) {
        showAppAlert('Lengkapi tanggal, nama barang, kategori, jumlah, dan total untuk setiap baris nota.', 'Periksa Baris Nota');
        return;
      }
      if (!currentUser) return showAppAlert('Silakan masuk kembali sebelum menyimpan.', 'Sesi Berakhir');
      const oversizedFile = [...rows].flatMap((row) => [...row.querySelector('.b-file').files])
        .find((file) => file.size > 10 * 1024 * 1024);
      if (oversizedFile) {
        showAppAlert(`File ${oversizedFile.name} melebihi batas 10 MB.`, 'Batas Ukuran');
        return;
      }

      showAppConfirm(`Simpan ${rows.length} nota ke dalam grup "${title}"?`, async () => {
        const btn = document.getElementById('btnSaveBatch');
        btn.disabled = true;
        btn.textContent = 'Menyimpan Batch...';

        try {
          const items = [];
          let groupTotal = 0;

          for (const row of rows) {
            const date = row.querySelector('.b-date').value;
            const name = row.querySelector('.b-name').value.trim();
            const categoryValue = row.querySelector('.b-cat').value;
            const cat = categoryValue === '__manual_price__' ? 'Lainnya' : categoryValue;
            const qty = Number(row.querySelector('.b-qty').value);
            const cust = row.querySelector('.b-cust').value;
            const total = Number(row.querySelector('.b-total').value);
            const inv = row.querySelector('.b-inv').value.trim();
            const fileInput = row.querySelector('.b-file');

            const uploadedUrls = [];
            if (fileInput.files.length > 0) {
              for (const file of Array.from(fileInput.files)) {
                const url = await uploadFileToCloudinary(file);
                uploadedUrls.push(url);
              }
            }

            items.push({ date, itemName: name, category: cat, qty, customer: cust, total, invoiceNo: inv, files: uploadedUrls });
            groupTotal += total;
          }

          const groupRecord = {
            id: createRecordId('grp'),
            isGroup: true,
            title: title,
            total: groupTotal,
            date: items[0]?.date || new Date().toISOString().split('T')[0],
            items: items
          };

          await saveRecord(currentUser.uid, 'transactions', groupRecord);
          updateLocalRecord('transactions', groupRecord);
          renderTransactions();
          renderChart();

          document.getElementById('batchGroupTitle').value = '';
          document.getElementById('batchTableBody').innerHTML = '';
          addBatchRow();
          showAppAlert('Seluruh nota grup tersimpan ke Cloud.', 'Sukses');
        } catch (err) {
          handleStorageError('menyimpan grup nota', err);
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4"></i><span>Simpan Semua Nota Grup Ini</span>';
          lucide.createIcons();
        }
      }, 'Konfirmasi Simpan Batch');
    }

    // TRANSACTIONS TABLE
    function renderTransactions(filterText = '') {
      const tbody = document.getElementById('txTableBody');
      const queryText = String(filterText || '').toLocaleLowerCase('id-ID');
      const filtered = dbTransactions.filter((transaction) => {
        if (!queryText) return true;
        const searchable = transaction.isGroup
          ? [transaction.title, ...(Array.isArray(transaction.items) ? transaction.items.map((item) => item.itemName) : [])]
          : [transaction.itemName, transaction.invoiceNo, transaction.category, transaction.customer];
        return searchable.some((value) => String(value || '').toLocaleLowerCase('id-ID').includes(queryText));
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400">Belum ada transaksi yang cocok.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map((t) => {
        const id = escapeHtml(t.id);
        if (t.isGroup) {
          const items = Array.isArray(t.items) ? t.items : [];
          return `
            <tr class="bg-indigo-50/70 hover:bg-indigo-50 font-semibold text-indigo-950 border-b border-slate-200">
              <td class="p-3">${escapeHtml(t.date)}</td>
              <td class="p-3 flex items-center space-x-2">
                <span class="bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">GRUP</span>
                <span>${escapeHtml(t.title)}</span>
              </td>
              <td class="p-3 text-slate-500">${items.length} Nota</td>
              <td class="p-3 text-center">-</td>
              <td class="p-3 text-slate-500">Beragam</td>
              <td class="p-3 text-right font-black text-indigo-700">Rp ${Number(t.total || 0).toLocaleString('id-ID')}</td>
              <td class="p-3 text-slate-500">-</td>
              <td class="p-3 text-center text-xs text-slate-500">${items.reduce((acc, cur) => acc + (cur.files?.length || 0), 0)} Berkas</td>
              <td class="p-3 text-center space-x-1.5">
                <button type="button" data-action="view-transaction" data-id="${id}" class="text-indigo-600 hover:text-indigo-800 p-1"><i data-lucide="eye" class="w-4 h-4 inline"></i></button>
                <button type="button" data-action="delete-transaction" data-id="${id}" class="text-red-500 hover:text-red-700 p-1"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>
              </td>
            </tr>
          `;
        }
        const firstFile = Array.isArray(t.files) ? safeExternalUrl(t.files[0]) : '';
        return `
            <tr class="hover:bg-slate-50 border-b border-slate-100 transition">
              <td class="p-3">${escapeHtml(t.date)}</td>
              <td class="p-3 font-semibold text-slate-800">${escapeHtml(t.itemName)}</td>
              <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-[11px] font-medium">${escapeHtml(t.category)}</span></td>
              <td class="p-3 text-center">${Number(t.qty || 0)}</td>
              <td class="p-3 text-slate-600">${escapeHtml(t.customer || 'Umum')}</td>
              <td class="p-3 text-right font-bold text-slate-900">Rp ${Number(t.total || 0).toLocaleString('id-ID')}</td>
              <td class="p-3 font-mono text-slate-500">${escapeHtml(t.invoiceNo)}</td>
              <td class="p-3 text-center">
                ${firstFile ? `<a href="${firstFile}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline">${t.files.length} File</a>` : '-'}
              </td>
              <td class="p-3 text-center space-x-1.5">
                <button type="button" data-action="view-transaction" data-id="${id}" class="text-indigo-600 hover:text-indigo-800 p-1"><i data-lucide="eye" class="w-4 h-4 inline"></i></button>
                <button type="button" data-action="delete-transaction" data-id="${id}" class="text-red-500 hover:text-red-700 p-1"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>
              </td>
            </tr>
          `;
      }).join('');
      lucide.createIcons();
    }

    window.viewDetail = function(id) {
      const item = dbTransactions.find(t => t.id === id);
      if (!item) return;

      const modal = document.getElementById('txDetailModal');
      const body = document.getElementById('modalTxBody');

      if (item.isGroup) {
        const items = Array.isArray(item.items) ? item.items : [];
        document.getElementById('modalTxTitle').textContent = `Grup: ${item.title || ''}`;
        document.getElementById('modalTxGroupSubtitle').textContent = `Total Biaya: Rp ${Number(item.total || 0).toLocaleString('id-ID')} | ${items.length} Nota`;

        let html = '<div class="space-y-4">';
        items.forEach((sub, idx) => {
          const files = (Array.isArray(sub.files) ? sub.files : []).map(safeExternalUrl).filter(Boolean);
          html += `
            <div class="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-2">
              <div class="flex justify-between font-bold border-b border-slate-200 pb-2 text-slate-900">
                <span>#${idx + 1} ${escapeHtml(sub.itemName)}</span>
                <span class="text-indigo-600">Rp ${Number(sub.total || 0).toLocaleString('id-ID')}</span>
              </div>
              <div class="grid grid-cols-2 text-xs text-slate-600 gap-1">
                <p><strong>Tanggal:</strong> ${escapeHtml(sub.date)}</p>
                <p><strong>No Nota:</strong> ${escapeHtml(sub.invoiceNo || '-')}</p>
                <p><strong>Kategori:</strong> ${escapeHtml(sub.category)}</p>
                <p><strong>Pembeli:</strong> ${escapeHtml(sub.customer)}</p>
              </div>
              ${files.length ? `
                <div class="flex gap-2 pt-2">
                  ${files.map((file) => `<a href="${file}" target="_blank" rel="noopener noreferrer"><img src="${file}" alt="Lampiran nota" class="w-16 h-16 object-cover rounded-xl border border-slate-300"></a>`).join('')}
                </div>
              ` : ''}
            </div>
          `;
        });
        html += '</div>';
        body.innerHTML = html;
      } else {
        const files = (Array.isArray(item.files) ? item.files : []).map(safeExternalUrl).filter(Boolean);
        document.getElementById('modalTxTitle').textContent = item.itemName || '';
        document.getElementById('modalTxGroupSubtitle').textContent = `No Nota: ${item.invoiceNo || '-'}`;

        body.innerHTML = `
          <div class="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-5 rounded-2xl border border-slate-200">
            <p><strong>Tanggal:</strong> ${escapeHtml(item.date)}</p>
            <p><strong>Kategori:</strong> ${escapeHtml(item.category)}</p>
            <p><strong>Jumlah (Qty):</strong> ${Number(item.qty || 0)}</p>
            <p><strong>Pembeli:</strong> ${escapeHtml(item.customer)}</p>
            <p class="col-span-2 text-lg font-black text-indigo-600">Total: Rp ${Number(item.total || 0).toLocaleString('id-ID')}</p>
          </div>
          ${files.length ? `
            <div>
              <h4 class="font-bold text-xs mb-2 text-slate-600">Berkas / Lampiran Nota:</h4>
              <div class="flex flex-wrap gap-3">
                ${files.map((file) => `<a href="${file}" target="_blank" rel="noopener noreferrer"><img src="${file}" alt="Lampiran nota" class="w-32 h-32 object-cover rounded-2xl border border-slate-300 shadow-sm"></a>`).join('')}
              </div>
            </div>
          ` : ''}
        `;
      }
      modal.classList.remove('hidden');
    }

    window.deleteTransaction = function(id) {
      showAppConfirm('Apakah Anda yakin ingin menghapus catatan transaksi ini secara permanen?', async () => {
        if (!currentUser) throw new Error('Sesi akun sudah berakhir.');
        await removeRecord(currentUser.uid, 'transactions', id);
        dbTransactions = dbTransactions.filter((transaction) => transaction.id !== id);
        renderTransactions();
        renderFileManager();
        renderChart();
        showAppAlert('Transaksi dihapus dari Cloud.', 'Sukses');
      }, 'Hapus Transaksi');
    }

    // FILE MANAGER
    function renderFileManager() {
      const grid = document.getElementById('fileManagerGrid');
      grid.innerHTML = '';

      const allFiles = [];
      dbTransactions.forEach(t => {
        if (t.isGroup) {
          (Array.isArray(t.items) ? t.items : []).forEach(i => {
            if (Array.isArray(i.files)) i.files.forEach(f => allFiles.push({ url: f, name: i.itemName, date: i.date }));
          });
        } else {
          if (Array.isArray(t.files)) t.files.forEach(f => allFiles.push({ url: f, name: t.itemName, date: t.date }));
        }
      });

      if (allFiles.length === 0) {
        grid.innerHTML = '<p class="col-span-full text-xs text-slate-400 italic text-center py-12">Belum ada file/gambar nota yang diunggah.</p>';
        return;
      }

      grid.innerHTML = allFiles.map((file) => {
        const url = safeExternalUrl(file.url);
        if (!url) return '';
        return `
          <div class="border border-slate-200 rounded-2xl p-2.5 bg-slate-50 hover:border-indigo-400 transition group">
            <a href="${url}" target="_blank" rel="noopener noreferrer">
              <img src="${url}" alt="Lampiran ${escapeHtml(file.name)}" class="w-full h-28 object-cover rounded-xl mb-2 group-hover:scale-[1.02] transition">
            </a>
            <p class="text-[11px] font-bold truncate text-slate-800">${escapeHtml(file.name)}</p>
            <p class="text-[9px] text-slate-400">${escapeHtml(file.date)}</p>
          </div>
        `;
      }).join('');
    }

    // ANALYTICS CHART WITH ZOOM & PAN
    function chartPeriodBucket(dateValue) {
      const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return { key: '~undated', label: 'Tanpa tanggal' };

      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month < 1 || month > 12) return { key: '~undated', label: 'Tanpa tanggal' };

      if (currentChartPeriod === 'monthly') {
        const date = new Date(Date.UTC(year, month - 1, 1));
        return {
          key: `${year}-${String(month).padStart(2, '0')}`,
          label: new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
        };
      }
      if (currentChartPeriod === 'quarterly') {
        const quarter = Math.floor((month - 1) / 3) + 1;
        return { key: `${year}-Q${quarter}`, label: `Kuartal ${quarter} ${year}` };
      }
      if (currentChartPeriod === 'yearly') {
        return { key: String(year), label: String(year) };
      }
      return { key: `${year}-${String(month).padStart(2, '0')}-${match[3]}`, label: `${year}-${match[2]}-${match[3]}` };
    }

    function renderChart() {
      const canvas = document.getElementById('biChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (currentChart) currentChart.destroy();

      const groupData = new Map();
      const addToPeriod = (date, amount) => {
        const period = chartPeriodBucket(date);
        const entry = groupData.get(period.key) || { label: period.label, total: 0 };
        entry.total += amount;
        groupData.set(period.key, entry);
      };

      if (currentChartMode !== 'loss') {
        dbTransactions.forEach(transaction => {
          const amount = Number(transaction.total) || 0;
          if (amount > 0) addToPeriod(transaction.date, amount);
        });
      }
      if (currentChartMode !== 'profit') {
        dbLosses.forEach(loss => {
          const amount = Math.abs(Number(loss.nominal) || 0);
          if (amount > 0) addToPeriod(loss.date, currentChartMode === 'combined' ? -amount : amount);
        });
      }

      const periods = [...groupData.entries()].sort(([keyA], [keyB]) => keyA.localeCompare(keyB, 'id'));
      const labels = periods.map(([, entry]) => entry.label);
      // Loss amounts are plotted upward for readability, then formatted as negative values.
      const values = periods.map(([, entry]) => currentChartMode === 'loss' ? Math.abs(entry.total) : entry.total);
      const hasData = values.length > 0;
      const color = currentChartMode === 'loss' ? '#dc2626' : currentChartMode === 'profit' ? '#059669' : '#4f46e5';
      const background = currentChartMode === 'loss'
        ? 'rgba(220, 38, 38, 0.1)'
        : currentChartMode === 'profit' ? 'rgba(5, 150, 105, 0.1)' : 'rgba(79, 70, 229, 0.1)';
      const amountLabel = value => {
        const amount = Math.round(Math.abs(Number(value) || 0)).toLocaleString('id-ID');
        if (currentChartMode === 'loss') return `-Rp ${amount}`;
        if (currentChartMode === 'combined' && Number(value) < 0) return `-Rp ${amount}`;
        return `Rp ${amount}`;
      };
      const datasetLabel = currentChartMode === 'loss' ? 'Kerugian' : currentChartMode === 'profit' ? 'Keuntungan' : 'Analisis Gabungan';

      currentChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: hasData ? labels : ['Belum ada data'],
          datasets: [{
            label: datasetLabel,
            data: hasData ? values : [0],
            borderColor: color,
            backgroundColor: background,
            borderWidth: 3,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: color,
            pointRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: context => `${datasetLabel}: ${amountLabel(context.raw)}`
              }
            },
            zoom: {
              zoom: {
                wheel: { enabled: true },
                pinch: { enabled: true },
                mode: 'xy',
              },
              pan: {
                enabled: true,
                mode: 'xy',
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(0, 0, 0, 0.05)' },
              ticks: { color: '#64748b' }
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(0, 0, 0, 0.05)' },
              ticks: {
                color,
                callback: value => amountLabel(currentChartMode === 'loss' ? -value : value)
              }
            }
          }
        }
      });
    }
