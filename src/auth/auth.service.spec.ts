import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { JwtService } from '@nestjs/jwt'
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { AuthService } from './auth.service'
import { User } from './schemas/user.schema'

jest.mock('bcrypt')

describe('AuthService', () => {
  let service: AuthService
  let mockUserModel: any
  let mockJwtService: { signAsync: jest.Mock }

  beforeEach(async () => {
    mockUserModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    }

    mockJwtService = {
      signAsync: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile()

    service = module.get<AuthService>(AuthService)
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('register', () => {
    it('should throw ConflictException if user already exists by username', async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: '123', username: 'existinguser' }),
      })

      await expect(
        service.register({ username: 'existinguser', password: 'password123' }),
      ).rejects.toThrow(ConflictException)
    })

    it('should throw ConflictException if user already exists by email', async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: '123', email: 'user@example.com' }),
      })

      await expect(
        service.register({ email: 'user@example.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException)
    })

    it('should throw BadRequestException if neither email nor username is provided', async () => {
      await expect(
        service.register({ password: 'password123' } as any),
      ).rejects.toThrow(BadRequestException)
    })

    it('should successfully register a new user with email only', async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      })
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword')
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => 'mock-id' },
        username: 'novousuario',
        email: 'novousuario@exemplo.com',
      })

      const result = await service.register({
        email: 'novousuario@exemplo.com',
        password: 'password123',
      })

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        $or: [{ email: 'novousuario@exemplo.com' }, { username: 'novousuario@exemplo.com' }],
      })
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10)
      expect(result).toEqual({
        id: 'mock-id',
        username: 'novousuario',
        email: 'novousuario@exemplo.com',
      })
    })

    it('should successfully register a new user with username', async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      })
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword')
      mockUserModel.create.mockResolvedValue({
        _id: { toString: () => 'mock-id' },
        username: 'newuser',
      })

      const result = await service.register({
        username: 'NewUser ',
        password: 'password123',
      })

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        $or: [{ username: 'newuser' }, { email: 'newuser' }],
      })
      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10)
      expect(result).toEqual({
        id: 'mock-id',
        username: 'newuser',
      })
    })
  })

  describe('login', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      })

      await expect(
        service.login({ username: 'user', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException if password does not match', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: { toString: () => 'user-id' },
          username: 'user',
          passwordHash: 'hashed',
        }),
      })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)

      await expect(
        service.login({ username: 'user', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('should return accessToken, expiresIn, and user info on valid credentials with username or email', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: { toString: () => 'user-id' },
          username: 'validuser',
          email: 'validuser@example.com',
          passwordHash: 'hashed',
        }),
      })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      mockJwtService.signAsync.mockResolvedValue('signed-jwt-token')

      const result = await service.login({
        username: 'validuser@example.com',
        password: 'correctpassword',
      })

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        $or: [{ username: 'validuser@example.com' }, { email: 'validuser@example.com' }],
      })
      expect(result).toEqual({
        accessToken: 'signed-jwt-token',
        expiresIn: '1d',
        user: { id: 'user-id', username: 'validuser', email: 'validuser@example.com' },
      })
    })

    it('should use 7d expiration when remember is true', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: { toString: () => 'user-id' },
          username: 'validuser',
          passwordHash: 'hashed',
        }),
      })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      mockJwtService.signAsync.mockResolvedValue('signed-jwt-token')

      const result = await service.login({
        username: 'validuser',
        password: 'correctpassword',
        remember: true,
      })

      expect(result.expiresIn).toBe('7d')
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-id', username: 'validuser' },
        { expiresIn: '7d' },
      )
    })
  })

  describe('updateUsername', () => {
    it('should throw ConflictException if target username is already taken by another user', async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'other-user', username: 'taken' }),
      })

      await expect(
        service.updateUsername('my-user-id', { username: 'taken' }),
      ).rejects.toThrow(ConflictException)
    })

    it('should update username successfully if available', async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      })
      const mockUser = {
        _id: { toString: () => 'my-user-id' },
        username: 'oldname',
        save: jest.fn().mockResolvedValue(true),
      }
      mockUserModel.findById.mockResolvedValue(mockUser)

      const result = await service.updateUsername('my-user-id', {
        username: 'newname',
      })

      expect(mockUser.username).toBe('newname')
      expect(mockUser.save).toHaveBeenCalled()
      expect(result).toEqual({
        id: 'my-user-id',
        username: 'newname',
      })
    })
  })

  describe('changePassword', () => {
    it('should throw UnauthorizedException if user does not exist or has no local password', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      })

      await expect(
        service.changePassword('user-id', {
          currentPassword: 'old',
          newPassword: 'new',
        }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException if current password does not match', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          passwordHash: 'hash',
        }),
      })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(false)

      await expect(
        service.changePassword('user-id', {
          currentPassword: 'wrong',
          newPassword: 'new',
        }),
      ).rejects.toThrow(UnauthorizedException)
    })

    it('should hash new password and save successfully', async () => {
      const mockUser = {
        passwordHash: 'old-hash',
        save: jest.fn().mockResolvedValue(true),
      }
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      })
      ;(bcrypt.compare as jest.Mock).mockResolvedValue(true)
      ;(bcrypt.hash as jest.Mock).mockResolvedValue('new-hash')

      const result = await service.changePassword('user-id', {
        currentPassword: 'valid-old',
        newPassword: 'super-new-password',
      })

      expect(bcrypt.hash).toHaveBeenCalledWith('super-new-password', 10)
      expect(mockUser.passwordHash).toBe('new-hash')
      expect(mockUser.save).toHaveBeenCalled()
      expect(result).toEqual({ ok: true })
    })
  })
})
