import {
  sanitizarDescricaoProduto,
  isEanValido,
  gerarChaveCanonica,
  removerAcentos,
  expandirAbreviacoesFiscais,
} from './sanitizar-produto.util'

describe('sanitizar-produto.util', () => {
  describe('sanitizarDescricaoProduto', () => {
    it('deve remover prefixos fiscais de embalagem e quantidade', () => {
      expect(
        sanitizarDescricaoProduto('1 UN - LEITE INTEGRAL PIRACANJUBA 1L'),
      ).toBe('LEITE INTEGRAL PIRACANJUBA 1L')
      expect(sanitizarDescricaoProduto('0.686 KG - BANANA NANICA')).toBe(
        'BANANA NANICA',
      )
      expect(sanitizarDescricaoProduto('1 CX - BOMBOM NESTLE')).toBe(
        'BOMBOM NESTLE',
      )
      expect(sanitizarDescricaoProduto('1 FR - SHAMPOO DOVE')).toBe(
        'SHAMPOO DOVE',
      )
      expect(sanitizarDescricaoProduto('1 PC - QUEIJO MUSSARELA')).toBe(
        'QUEIJO MUSSARELA',
      )
    })

    it('deve remover prefixos de setores e departamentos de supermercados', () => {
      expect(sanitizarDescricaoProduto('HORT BANANA PRATA')).toBe(
        'BANANA PRATA',
      )
      expect(sanitizarDescricaoProduto('HORTI - TOMATE CARMEM')).toBe(
        'TOMATE CARMEM',
      )
      expect(sanitizarDescricaoProduto('ACOU PICANHA BOVINA')).toBe(
        'PICANHA BOVINA',
      )
      expect(sanitizarDescricaoProduto('MERCEARIA ARROZ TIO JOAO')).toBe(
        'ARROZ TIO JOAO',
      )
      expect(sanitizarDescricaoProduto('PAD PAO FRANCES')).toBe('PAO FRANCES')
      expect(sanitizarDescricaoProduto('BEBIDAS CERVEJA HEINEKEN')).toBe(
        'CERVEJA HEINEKEN',
      )
    })

    it('deve remover prefixos com combinação de setor e quantidade', () => {
      expect(sanitizarDescricaoProduto('HORT 0.500 KG - MAMAO FORMOSA')).toBe(
        'MAMAO FORMOSA',
      )
    })

    it('deve remover códigos numéricos de balança / PLU no início', () => {
      expect(sanitizarDescricaoProduto('4011 - BANANA PRATA')).toBe(
        'BANANA PRATA',
      )
      expect(sanitizarDescricaoProduto('PLU 1234 - COUVE')).toBe('COUVE')
      expect(sanitizarDescricaoProduto('#9999 CENOURA')).toBe('CENOURA')
    })

    it('deve remover siglas de estado no início e unidades no final', () => {
      expect(sanitizarDescricaoProduto('SP LEITE INTEGRAL 1L UN')).toBe(
        'LEITE INTEGRAL 1L',
      )
    })
  })

  describe('isEanValido', () => {
    it('deve validar EANs padrão GS1 válidos (8, 12, 13 ou 14 dígitos)', () => {
      expect(isEanValido('7891000100103')).toBe(true)
      expect(isEanValido('12345678')).toBe(true)
      expect(isEanValido('123456789012')).toBe(true)
      expect(isEanValido('12345678901234')).toBe(true)
    })

    it('deve rejeitar SEM GTIN, nulos e strings com letras', () => {
      expect(isEanValido(null)).toBe(false)
      expect(isEanValido(undefined)).toBe(false)
      expect(isEanValido('SEM GTIN')).toBe(false)
      expect(isEanValido('SEMGTIN')).toBe(false)
      expect(isEanValido('NAO INFORMADO')).toBe(false)
      expect(isEanValido('ABC1234567890')).toBe(false)
    })

    it('deve rejeitar códigos de balança interna que começam com 2 e têm 13 dígitos', () => {
      expect(isEanValido('2000012345678')).toBe(false)
    })
  })

  describe('gerarChaveCanonica', () => {
    it('deve gerar chave baseada em EAN se o código for válido', () => {
      expect(
        gerarChaveCanonica('7891000100103', 'MERC LEITE PIRACANJUBA'),
      ).toBe('EAN_7891000100103')
      expect(
        gerarChaveCanonica('7891000100103', '1 UN - LEITE PIRACANJUBA 1L'),
      ).toBe('EAN_7891000100103')
    })

    it('deve unificar produtos com prefixos diferentes quando não possuem EAN', () => {
      const chave1 = gerarChaveCanonica(
        null,
        '1 UN - LEITE INTEGRAL PIRACANJUBA 1L',
      )
      const chave2 = gerarChaveCanonica(
        null,
        'MERC PIRACANJUBA LEITE INTEGRAL 1L',
      )
      const chave3 = gerarChaveCanonica(
        'SEM GTIN',
        'LEITE INTEGRAL PIRACANJUBA 1L',
      )

      expect(chave1).toBe(chave2)
      expect(chave2).toBe(chave3)
      expect(chave1).toBe('CANON_1L_INTEGRAL_LEITE_PIRACANJUBA')
    })

    it('deve unificar itens pesáveis de hortifrúti entre mercados diferentes', () => {
      const chaveMercadoA = gerarChaveCanonica(
        '2000012345678',
        '0.686 KG - BANANA NANICA',
      )
      const chaveMercadoB = gerarChaveCanonica(null, 'HORT BANANA NANICA')
      const chaveMercadoC = gerarChaveCanonica('SEM GTIN', '4011 - BANANA NANICA')

      expect(chaveMercadoA).toBe('CANON_BANANA_NANICA')
      expect(chaveMercadoB).toBe('CANON_BANANA_NANICA')
      expect(chaveMercadoC).toBe('CANON_BANANA_NANICA')
    })

    it('deve unificar abreviações fiscais como Musculo no mercado X e Musc no mercado Y', () => {
      const chaveMercadoX = gerarChaveCanonica(null, '1.006 KG - MUSCULO')
      const chaveMercadoY = gerarChaveCanonica(null, 'MUSC')
      const chaveMercadoZ = gerarChaveCanonica('9999', 'CARNE MUSC')

      expect(chaveMercadoX).toBe('CANON_MUSCULO')
      expect(chaveMercadoY).toBe('CANON_MUSCULO')
      expect(chaveMercadoZ).toBe('CANON_CARNE_MUSCULO')
    })
  })

  describe('removerAcentos e expandirAbreviacoesFiscais', () => {
    it('deve remover acentuação corretamente', () => {
      expect(removerAcentos('AÇÚCAR MAÇÃ CAFÉ PÃO')).toBe('ACUCAR MACA CAFE PAO')
    })

    it('deve expandir termos abreviados da SEFAZ', () => {
      expect(expandirAbreviacoesFiscais('MUSC')).toBe('MUSCULO')
      expect(expandirAbreviacoesFiscais('MAC PEN')).toBe('MACARRAO PENNE')
      expect(expandirAbreviacoesFiscais('TOM CARMEM')).toBe('TOMATE CARMEM')
    })
  })
})
