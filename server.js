// ARQUIVO: server.js (VERSÃO COM CORREÇÃO FINAL DE FUSO HORÁRIO)

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(cors());
const PORTA = 3000;

const HISTORICO_PATH = './historico_completo.json';

let historicoDeResultados = [];
try {
    if (fs.existsSync(HISTORICO_PATH)) {
        const data = fs.readFileSync(HISTORICO_PATH, 'utf8');
        historicoDeResultados = JSON.parse(data);
        console.log(`Carregados ${historicoDeResultados.length} resultados do histórico.`);
    }
} catch (err) {
    console.error("Erro ao carregar o histórico:", err);
}

async function buscarNovosResultados() {
    try {
        const response = await axios.get('https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1');
        const dadosDaApi = response.data;
        if (!dadosDaApi || dadosDaApi.length === 0) { return; }
        const ultimoResultadoApi = dadosDaApi[0];
        if (historicoDeResultados.length > 0 && historicoDeResultados[0].id === ultimoResultadoApi.id) { return; }
        
        let corTexto;
        switch (ultimoResultadoApi.color) {
            case 0: corTexto = 'white'; break;
            case 1: corTexto = 'red'; break;
            case 2: corTexto = 'black'; break;
            default: corTexto = 'black';
        }
        
        const dataUTC = new Date(ultimoResultadoApi.created_at);
        
        // ===================================================================
        // ## LÓGICA DE FUSO HORÁRIO CORRIGIDA ##
        
        // Ajusta manualmente o horário de UTC para UTC-3 (Horário de Brasília)
        const dataBrasilia = new Date(dataUTC.getTime() - (3 * 60 * 60 * 1000));
        
        // Agora extraímos a data e a hora a partir da data já corrigida
        const timestampFormatado = dataBrasilia.toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'UTC' // Usamos UTC aqui porque já ajustamos o tempo manualmente
        });
        const isoDateCorreta = dataBrasilia.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // ===================================================================

        const novoResultado = {
            id: ultimoResultadoApi.id,
            value: ultimoResultadoApi.roll.toString().padStart(2, '0'),
            color: corTexto,
            timestamp: timestampFormatado,
            isoDate: isoDateCorreta
        };

        historicoDeResultados.unshift(novoResultado);

        const dataCorte = new Date();
        dataCorte.setDate(dataCorte.getDate() - 4);
        const dataCorteISO = dataCorte.toISOString().split('T')[0];
        historicoDeResultados = historicoDeResultados.filter(resultado => resultado.isoDate >= dataCorteISO);
        
        fs.writeFileSync(HISTORICO_PATH, JSON.stringify(historicoDeResultados, null, 2));
        console.log("Novo resultado adicionado:", novoResultado.timestamp, "Data:", novoResultado.isoDate);

    } catch (error) {
        console.error("Erro ao buscar dados da API:", error.message);
    }
}

function calcularEstatisticasBranco() {
    if (historicoDeResultados.length === 0) return { rodadasAtras: 0, minutosAtras: 0, maximaRodadas: 0 };
    const agora = new Date();
    let ultimoBrancoIndex = -1, ultimoBrancoTimestamp = null;
    for (let i = 0; i < historicoDeResultados.length; i++) {
        if (historicoDeResultados[i].color === 'white') {
            ultimoBrancoIndex = i;
            const [horas, minutos] = historicoDeResultados[i].timestamp.split(':');
            ultimoBrancoTimestamp = new Date();
            ultimoBrancoTimestamp.setHours(horas, minutos, 0, 0);
            if (ultimoBrancoTimestamp > agora) ultimoBrancoTimestamp.setDate(ultimoBrancoTimestamp.getDate() - 1);
            break;
        }
    }
    const rodadasAtras = ultimoBrancoIndex === -1 ? historicoDeResultados.length : ultimoBrancoIndex;
    const minutosAtras = ultimoBrancoTimestamp ? Math.floor((agora - ultimoBrancoTimestamp) / 60000) : rodadasAtras;
    let maximaRodadas = 0, contadorDesdeUltimoBranco = 0;
    historicoDeResultados.forEach(r => {
        if (r.color === 'white') {
            if (contadorDesdeUltimoBranco > maximaRodadas) maximaRodadas = contadorDesdeUltimoBranco;
            contadorDesdeUltimoBranco = 0;
        } else { contadorDesdeUltimoBranco++; }
    });
    if (contadorDesdeUltimoBranco > maximaRodadas) maximaRodadas = contadorDesdeUltimoBranco;
    return { rodadasAtras, minutosAtras, maximaRodadas };
}

function calcularEstatisticasPorHora(dataRequisitada) {
    const stats = {};
    for (let i = 0; i < 24; i++) {
        const hour = i.toString().padStart(2, '0');
        stats[hour] = { red: 0, black: 0, white: 0 };
    }
    historicoDeResultados.forEach(resultado => {
        if (resultado.isoDate === dataRequisitada) {
            const hour = resultado.timestamp.substring(0, 2);
            if (stats[hour] && resultado.color) { stats[hour][resultado.color]++; }
        }
    });
    return stats;
}

app.get('/api/results', (req, res) => {
    res.json(historicoDeResultados.slice(0, 500));
});

app.get('/api/stats', (req, res) => {
    res.json(calcularEstatisticasBranco());
});

app.get('/api/hourly-stats', (req, res) => {
    const hoje = new Date();
    const dataBrasiliaHoje = new Date(hoje.getTime() - (3 * 60 * 60 * 1000));
    const hojeISO = dataBrasiliaHoje.toISOString().split('T')[0];
    
    const dataRequisitada = req.query.date || hojeISO;
    res.json(calcularEstatisticasPorHora(dataRequisitada));
});

app.listen(PORTA, () => {
    console.log(`Servidor rodando na porta ${PORTA}`);
    setInterval(buscarNovosResultados, 15000);
});