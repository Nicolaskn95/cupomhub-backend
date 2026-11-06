import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import * as bcrypt from 'bcrypt'
import { Model } from 'mongoose'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { UpdateUsernameDto } from './dto/update-username.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { OAuth2Client } from 'google-auth-library'
import { GoogleLoginDto } from './dto/google-login.dto'
import { JwtPayload } from './strategies/jwt.strategy'
import { User, UserDocument } from './schemas/user.schema'

const SALT_ROUNDS = 10

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const rawEmail =
      dto.email || (dto.username?.includes('@') ? dto.username : undefined)

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS)

    if (rawEmail) {
      const cleanEmail = rawEmail.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new BadRequestException('Formato de e-mail inválido')
      }

      const existing = await this.userModel
        .findOne({
          $or: [{ email: cleanEmail }, { username: cleanEmail }],
        })
        .lean()
      if (existing) {
        throw new ConflictException('E-mail já está em uso')
      }

      let baseUsername =
        dto.username && !dto.username.includes('@')
          ? dto.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
          : cleanEmail.split('@')[0].replace(/[^a-z0-9_]/g, '')

      if (baseUsername.length < 3) {
        baseUsername = `user_${Math.random().toString(36).substring(2, 8)}`
      }

      let username = baseUsername
      let count = 1
      while (await this.userModel.findOne({ username }).lean()) {
        username = `${baseUsername}_${count}`
        count++
      }

      const user = await this.userModel.create({
        username,
        email: cleanEmail,
        passwordHash,
      })

      return {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
      }
    }

    if (!dto.username) {
      throw new BadRequestException('E-mail ou nome de usuário é obrigatório')
    }

    const username = dto.username.trim().toLowerCase()
    const existing = await this.userModel
      .findOne({
        $or: [{ username }, { email: username }],
      })
      .lean()
    if (existing) {
      throw new ConflictException('Nome de usuário já está em uso')
    }

    const user = await this.userModel.create({ username, passwordHash })
    return {
      id: user._id.toString(),
      username: user.username,
    }
  }

  async login(dto: LoginDto) {
    const identifier = dto.username.trim().toLowerCase()
    const user = await this.userModel
      .findOne({
        $or: [{ username: identifier }, { email: identifier }],
      })
      .select('+passwordHash')
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials')
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash)
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials')
    }
    const expiresIn = dto.remember ? '7d' : '1d'
    const payload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
    }
    const accessToken = await this.jwtService.signAsync(payload, { expiresIn })
    return {
      accessToken,
      expiresIn,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
      },
    }
  }

  async updateUsername(userId: string, dto: UpdateUsernameDto) {
    const username = dto.username.trim().toLowerCase()

    const existing = await this.userModel
      .findOne({ username, _id: { $ne: userId } })
      .lean()
    if (existing) {
      throw new ConflictException('Username already in use')
    }

    const user = await this.userModel.findById(userId)
    if (!user) {
      throw new UnauthorizedException()
    }

    user.username = username
    await user.save()

    return { id: user._id.toString(), username: user.username }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId).select('+passwordHash')
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('User does not have a local password')
    }

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!ok) {
      throw new UnauthorizedException('Current password is invalid')
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS)
    await user.save()

    return { ok: true }
  }

  private googleOAuthClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID ||
      '743020408271-ge3g4tooe22eb2m83vsek8iuvfedjhrj.apps.googleusercontent.com',
  )

  private async verifyGoogleToken(token: string): Promise<{
    sub: string
    email: string
    name?: string
    picture?: string
  }> {
    if (token.startsWith('ya29.')) {
      try {
        const res = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
        if (!res.ok) {
          throw new Error('Falha na requisição userinfo do Google')
        }
        const userInfo = await res.json()
        if (!userInfo || !userInfo.sub || !userInfo.email) {
          throw new UnauthorizedException('Informações do Google incompletas')
        }
        return {
          sub: userInfo.sub,
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err
        throw new UnauthorizedException('Token do Google inválido')
      }
    }

    try {
      const ticket = await this.googleOAuthClient.verifyIdToken({
        idToken: token,
        audience: [
          process.env.GOOGLE_CLIENT_ID ||
            '743020408271-ge3g4tooe22eb2m83vsek8iuvfedjhrj.apps.googleusercontent.com',
        ],
      })
      const payload = ticket.getPayload()
      if (!payload || !payload.sub || !payload.email) {
        throw new UnauthorizedException('Informações do Google incompletas')
      }
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err
      throw new UnauthorizedException('Token do Google inválido')
    }
  }

  async googleLogin(dto: GoogleLoginDto) {
    const payload = await this.verifyGoogleToken(dto.idToken)
    const { sub: googleId, email, name, picture } = payload
    const cleanEmail = email.toLowerCase().trim()

    let user = await this.userModel.findOne({
      $or: [{ googleId }, { email: cleanEmail }, { username: cleanEmail }],
    })

    if (!user) {
      let baseUsername = cleanEmail.split('@')[0].replace(/[^a-z0-9_]/g, '')
      if (baseUsername.length < 3) baseUsername = `user_${googleId.slice(0, 6)}`

      let username = baseUsername
      let count = 1
      while (await this.userModel.findOne({ username }).lean()) {
        username = `${baseUsername}_${count}`
        count++
      }

      user = await this.userModel.create({
        username,
        email: cleanEmail,
        googleId,
        avatarUrl: picture,
      })
    } else {
      let updated = false
      if (!user.googleId) {
        user.googleId = googleId
        updated = true
      }
      if (!user.email) {
        user.email = cleanEmail
        updated = true
      }
      if (picture && !user.avatarUrl) {
        user.avatarUrl = picture
        updated = true
      }
      if (updated) {
        await user.save()
      }
    }

    const expiresIn = dto.remember ? '7d' : '1d'
    const jwtPayload: JwtPayload = {
      sub: user._id.toString(),
      username: user.username,
    }
    const accessToken = await this.jwtService.signAsync(jwtPayload, {
      expiresIn,
    })

    return {
      accessToken,
      expiresIn,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    }
  }

  async getUserProfile(userId: string) {
    const user = await this.userModel.findById(userId).select('+passwordHash')
    if (!user) {
      throw new UnauthorizedException()
    }
    return {
      id: user._id.toString(),
      username: user.username,
      email: user.email || null,
      googleId: user.googleId || null,
      avatarUrl: user.avatarUrl || null,
      hasGoogleLinked: !!user.googleId,
      hasPassword: !!user.passwordHash,
    }
  }

  async linkGoogleAccount(userId: string, idToken: string) {
    const payload = await this.verifyGoogleToken(idToken)
    const { sub: googleId, email, picture } = payload
    const cleanEmail = email.toLowerCase().trim()

    const existingOther = await this.userModel.findOne({
      googleId,
      _id: { $ne: userId },
    })
    if (existingOther) {
      throw new ConflictException(
        'Esta conta do Google já está vinculada a outro usuário',
      )
    }

    const user = await this.userModel.findById(userId)
    if (!user) {
      throw new UnauthorizedException()
    }

    user.googleId = googleId
    user.email = cleanEmail
    if (picture) user.avatarUrl = picture
    await user.save()

    return {
      ok: true,
      googleId: user.googleId,
      email: user.email,
      avatarUrl: user.avatarUrl,
    }
  }

  async unlinkGoogleAccount(userId: string) {
    const user = await this.userModel.findById(userId).select('+passwordHash')
    if (!user) {
      throw new UnauthorizedException()
    }

    if (!user.passwordHash) {
      throw new BadRequestException(
        'Você não pode desvincular o Google sem ter uma senha definida',
      )
    }

    user.googleId = undefined
    await user.save()

    return { ok: true }
  }
}
